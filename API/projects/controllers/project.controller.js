const logger = require("../../../config/logger");
const { Project, ProjectSkill, ProjectPhoto, Application, sequelize } = require("../../../models");
const { QueryTypes } = require("sequelize");
const { projectPostSchema } = require("../controllers/projectValidation.controller");
const multer = require("multer");
const multerS3 = require("multer-s3");
const aws = require("aws-sdk");
const s3 = new aws.S3();
const moment = require("moment");
const { v4 } = require("uuid");
const { redisClient, DEFAULT_EXPIRATION } = require("../../../config/redis");

// multer - S3 이미지 업로드 설정

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "jerryjudymary",
    acl: "public-read",
    key: function (req, file, cb) {
      // 이미지 파일 이름 설정
      cb(null, "projectImage/" + v4().toString().replace("-", "") + "." + file.originalname.split(".").pop());
    },
  }),
});

// 이미지 업로드

exports.projectPhotos = async (req, res) => {
  try {
    const photos = req.files.map((image) => image.location);
    res.status(200).json({ message: "사진을 업로드했습니다.", photos });
  } catch (err) {
    logger.error(err);
    return res.status(400).send({ errorMessage: "사진업로드 실패-파일 형식과 크기(1.5Mb 이하) 를 확인해주세요." });
  }
};

// 프로젝트 등록

exports.project = async (req, res) => {
  if (!res.locals.user) {
    return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });
  }

  const { id, nickname, userId } = res.locals.user;

  if (!id || !nickname || !userId) {
    return res.status(404).json({ errorMessage: "회원정보가 올바르지 않습니다." });
  }

  try {
    var { title, details, subscript, role, start, end, skills, schedule, photos }
    = await projectPostSchema.validateAsync(req.body);
  } catch (err) {
    logger.error(err);
    return res.status(400).json({ errorMessage: "작성 형식을 확인해주세요." });
  }

  if (!title || !details || !subscript || !role || !start || !end || !skills || !schedule) {
    return res.status(400).json({ errorMessage: "작성란을 모두 기입해주세요." });
  }

  const startMsec = Date.parse(start);
  const endMsec = Date.parse(end);
  if (startMsec >= endMsec) return res.status(400).json({ errorMessage: "날짜 형식이 잘못되었습니다." });

  const available = true;
  const createdAt = moment().format("YYYY-MM-DD HH:mm:ss");
  const email = userId;

  // 시퀄라이즈 쿼리의 반환값은 promise로 반환되므로 .then을 붙여 이용해 줍니다

  try {
    await Project.create({ title, details, subscript, role, start, end, email, id, nickname, createdAt }).then((result) => {
      schedule.forEach((time) => Application.create({ projectId: result.projectId, schedule: time, available }));

      skills.forEach((skill) => ProjectSkill.create({ projectId: result.projectId, skill }));

      if (photos || photos.length) {
        photos.forEach((photo) => ProjectPhoto.create({ projectId: result.projectId, photo }));
      }
    });

    redisClient.del(`projects`, function(err, response) {
      if (response == 1) console.log("새 프로젝트 등록으로 전체조회 캐시 삭제")

    });

    await res.status(200).json({ message: "프로젝트 게시글을 작성했습니다." });
  } catch (error) {
    logger.error(error);
    return res.status(400).json({ errorMessage: "게시글 등록 실패" });
  }
};

// 프로젝트 조회

exports.projectInfo = async (req, res) => {
  redisClient.get("projects", async (err, data) => { // 레디스 서버에서 데이터 체크, 레디스에 저장되는 키 값은 projects
    if (err) console.error(error);
    if (data) return res.json({ projects: JSON.parse(data) }); // 캐시 적중(cache hit)시 response!
  
    const query = `SELECT project.projectId, nickname, title, subscript, role, start, end, createdAt,
      JSON_ARRAYAGG(skill) AS skills ${/* inner join으로 가져오고 쿼리 말미에 그룹화하는 project_skill 테이블의 skill을 skills라는 alias로 받아옵니다. */''}
      FROM project INNER JOIN project_skill
      ON project.projectId = project_skill.projectId
      GROUP BY project.projectId`; // 자식 테이블의 컬럼(skill)을 그룹화할 것이기 때문에, 자식 테이블의 FK 기준으로 GROUP BY 해야 합니다!
    const projects = await sequelize.query(query, { type: QueryTypes.SELECT });

    if (!projects.length) {
      return res.status(404).json({ errorMessage: "프로젝트가 존재하지 않습니다." });
    };

    // 캐시 부적중(cache miss)시 DB에 쿼리 전송, setex 메서드로 설정한 기본 만료시간까지 redis 캐시 저장
    redisClient.setex("projects", DEFAULT_EXPIRATION, JSON.stringify(projects));
    res.send({ projects });
  });
};

// 프로젝트 상세 조회

exports.projectDetail = async (req, res) => {
  const { projectId } = req.params;
  // 레디스 서버에서 데이터 체크, 레디스에 저장되는 키 값은 projects
  redisClient.get(`projects:${projectId}`, async (err, data) => {
    if (err) console.error(error);
    if (data) return res.json({ project: JSON.parse(data) }); // 캐시 적중(cache hit)시 response!

    const query = ` ${/* 이중 서브쿼리이므로 가운데부터 봐 주세요. */''}
      SELECT secondQ.*, JSON_ARRAYAGG(JSON_OBJECT( ${/* JSON_OBJECT만 쓰면 GROUP BY 메서드로 사용하지 못합니다 */''}
        'applicationId', applicationId,
        'available', available,
        'schedule', DATE_FORMAT(schedule,'%Y-%m-%d %H:%i:%S'),
        'status', status,
        'interviewCode', interviewCode
      )) AS applications
      FROM(

        SELECT mainQ.*, JSON_ARRAYAGG(photo) AS photos ${/* 이렇게 두 번째 join 부터 인라인 뷰 서브쿼리를 쓰는 이유는, */''}
        FROM( ${/* 단순히 나열하여 join할 경우 테이블의 결과값마다 서로 카티젼 곱이 되어 중복된 레코드를 출력하기 때문이죠! */''}

          SELECT project.*,
          JSON_ARRAYAGG(skill) AS skills
          FROM project

          INNER JOIN project_skill ${/* project_skill 테이블부터 join 후 그루핑 */''}
          ON project.projectId = project_skill.projectId

          WHERE project.projectId = '${projectId}'
          GROUP BY project.projectId

        ) mainQ ${/* 인라인 뷰 서브쿼리의 경우 무조건 alias를 붙여 줘야 구문 오류가 생기지 않습니다 */''}
      
        LEFT JOIN project_photo ${/* photo의 경우 null 값도 존재하므로 LEFT JOIN 해 줍니다 */''}
        ON mainQ.projectId = project_photo.projectId

        GROUP BY mainQ.projectId

      ) secondQ

      INNER JOIN application
      ON secondQ.projectId = application.projectId

      GROUP BY secondQ.projectId
    `; 

    const project = await sequelize.query(query, { type: QueryTypes.SELECT });

    if (!project.length) {
      return res.status(404).json({ errorMessage: "프로젝트 정보가 존재하지 않습니다." });
    }
  
    // 캐시 부적중(cache miss)시 DB에 쿼리 전송, setex 메서드로 설정한 기본 만료시간까지 redis 캐시 저장
    redisClient.setex(`projects:${projectId}`, DEFAULT_EXPIRATION, JSON.stringify(project));
    res.send({ project: project[0] });
  });
};

// 프로젝트 수정

exports.projectUpdate = async (req, res) => {
  if (!res.locals.user) {
    return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });
  }

  const { id, nickname } = res.locals.user;
  const { projectId } = req.params;

  const existProject = await Project.findOne({
    where: { projectId, id },
  });

  if (!existProject) {
    return res.status(404).json({ errorMessage: "회원님께서 등록한 프로젝트가 아닙니다." });
  }

  if (id !== existProject.id) {
    return res.status(400).send({ errorMessage: "작성자만 수정할 수 있습니다." });
  }

  try {
    var { title, details, subscript, role, start, end, skills, photos } = await projectPostSchema.validateAsync(req.body);
  } catch (err) {
    logger.error(error);
    return res.status(400).json({ errorMessage: "작성 형식을 확인해주세요." });
  }

  if (!title || !details || !subscript || !role || !start || !end || !skills) {
    return res.status(400).json({ errorMessage: "작성란을 모두 기입해주세요." });
  }

  const startMsec = Date.parse(start);
  const endMsec = Date.parse(end);
  if (startMsec >= endMsec) return res.status(400).json({ errorMessage: "날짜 형식이 잘못되었습니다." });

  // --- 기존 이미지 선별적 다중 삭제

  const existPhotos = await ProjectPhoto.findAll({
    where: { projectId },
  });

  if (existPhotos.length) {
    let deletePhotos = [];
    let photoUrl;
    let photo;
    existPhotos.forEach((item) => {
      photoUrl = item.dataValues.photo; // DB에 저장되어있는 URL에서 키값만 추출
      if (photos.includes(photoUrl) === false) {
        // photoUrl(기존 DB에 있는 각 이미지 URL이 body로 온 photos에 없다면 해당 URL 삭제)
        photo = photoUrl.split(".com/")[1];
        deletePhotos.push({ Key: photo }); // [{키: 밸류},{키: 밸류}] 형태로 전달해 줍니다
      }
    });

    if (deletePhotos.length) {
      const params = {
        Bucket: "jerryjudymary",
        Delete: {
          Objects: deletePhotos,
          Quiet: false,
        },
      };

      s3.deleteObjects(params, function (err, data) {
        if (err) {
          logger.error("버킷 이미지 삭제 에러:", err);
          return err;
        }
      });
    }
  }

  // ---

  // 예외처리 문제로 트랜잭션 밖으로 빼 줍니다.
  if (photos || photos.length) {
    await ProjectPhoto.destroy({ where: { projectId } });
    for (let i = 0; i < photos.length; i++) {
      await ProjectPhoto.create({ projectId, photo: photos[i] });
    }
  }

  const t = await sequelize.transaction(); // 이하 쿼리들 트랜잭션 처리

  try {
    await Project.update({ title, details, subscript, role, start, end, nickname }, { where: { projectId }, transaction: t });

    /* 현재 스케쥴부분 MVP까지 수정 제외로 주석처리합니다 

    // 등록 당시의 개수와 수정 당시의 개수가 다르면 update 사용 곤란으로 삭제 후 재등록 처리
    //현재 스케쥴을 등록하면 이전 스케쥴은 무조건 사라지는 문제 해결해야 함( 프론트에서 해결 가능..? )
    await Application.destroy({ where: { projectId }, transaction: t }); // delete로 지워주고 새로 등록
    for (let i = 0; i < schedule.length; i++) {
      await Application.create({ projectId, schedule : schedule[i] }, { transaction: t });
    }; // 추후 available등 수정 시 사항 추가 가능하게? -> 면접시간 수정용 API가 하나 더 있어야할 것 같다.
    */

    // 스케쥴과 동일한 문제 있음
    await ProjectSkill.destroy({ where: { projectId }, transaction: t });
    for (let i = 0; i < skills.length; i++) {
      await ProjectSkill.create({ projectId, skill: skills[i] }, { transaction: t });
    }

    await t.commit();

    // 수정시 해당 프로젝트, 전체조회 캐싱용 Redis 키 삭제
    redisClient.del(`projects:${projectId}`, `projects`, function (err, response) {
      if (response == 1) console.log("1 Redis key deleted");
      if (response == 2) console.log("2 Redis key deleted");
    });

    return res.status(200).json({
      message: "프로젝트 게시글을 수정했습니다.",
    });
  } catch (error) {
    logger.error(error);
    await t.rollback();
    return error;
  }
};

// 프로젝트 삭제

exports.projectDelete = async (req, res) => {
  if (!res.locals.user) {
    return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });
  }

  const { id } = res.locals.user;
  const { projectId } = req.params;

  const existProject = await Project.findOne({
    where: { projectId, id },
  });

  if (!existProject) {
    return res.status(404).json({ errorMessage: "회원님께서 등록한 프로젝트가 아닙니다." });
  }

  if (id !== existProject.id) {
    return res.status(401).send({ errorMessage: "작성자만 삭제할 수 있습니다." });
  }

  // --- 기존 이미지 다중 삭제

  const existPhotos = await ProjectPhoto.findAll({
    where: { projectId },
  });

  if (existPhotos.length) {
    let deletePhotos = [];
    existPhotos.forEach((item) => {
      let photoUrl = item.dataValues.photo; // DB에 저장되어있는 URL에서 키값만 추출
      const photo = photoUrl.split(".com/")[1];
      deletePhotos.push({ Key: photo }); // [{키: 밸류},{키: 밸류}] 형태로 전달해 줍니다
    });

    const params = {
      Bucket: "jerryjudymary",
      Delete: {
        Objects: deletePhotos,
        Quiet: false,
      },
    };

    s3.deleteObjects(params, function (err, data) {
      if (err) {
        logger.error("버킷 이미지 삭제 에러:", err);
        return err;
      }
    });
  }

  // ---

  Project.destroy({
    // ON DELETE CASCADE 적용으로 자식 테이블의 데이터도 지워집니다
    where: { projectId, id },
  });

  // 삭제시 해당 프로젝트, 전체조회 캐싱용 Redis 키 삭제
  redisClient.del(`projects:${projectId}`, `projects`, function (err, response) {
    if (response == 1) console.log("1 Redis key deleted");
    if (response == 2) console.log("2 Redis key deleted");
  });

  res.status(200).json({
    message: "프로젝트 게시글을 삭제했습니다.",
  });
};
