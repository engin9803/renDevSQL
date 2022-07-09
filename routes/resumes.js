const express = require("express");
const router = express.Router();
const multer = require("multer");
const { Op } = require("sequelize");
const { User, Resume, ResumeSkill, sequelize } = require("../models");
const multerS3 = require("multer-s3");
const aws = require("aws-sdk");
const s3 = new aws.S3();
const authMiddleware = require("../middlewares/authMiddleware");
const { resume } = require("../config/database");

// const moments = require("moment-timezone");
// const moments.tz.setDefault("Asia/Seoul");

// multer - S3 이미지 업로드 설정
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "jerryjudymary",
    acl: "public-read",
    key: function (req, file, cb) {
      cb(null, "resumeImage/" + Date.now() + "." + file.originalname.split(".").pop()); // 이름 설정
    },
  }),
});

// 이미지 업로드
router.post("/image", upload.single("resumeImage"), async (req, res) => {
  // router.post("/image", authMiddleware, upload.single("resumeImage"), async (req, res) => {
  try {
    const resumeImage = req.file.location;
    return res.status(200).json({ message: "사진을 업로드 했습니다.", resumeImage });
  } catch (err) {
    console.log(err);
    res.status(400).send({ errorMessage: "사진업로드 실패-파일 형식과 크기(1.5Mb 이하) 를 확인해주세요." });
  }
});

// 팀원 찾기 등록
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { id, userId, nickname } = res.locals.user;
    const { content, start, end, role, skill, resumeImage, content2, content3 } = req.body;

    if (!userId) return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });

    const users = User.findOne({ attributes: ["userId", "nickname"], where: { userId, nickname } });

    const createdAt = new Date();

    await Resume.create({ id, userId, nickname, content, start, end, role, content2, content3, resumeImage, createdAt }).then((result) => {
      for (let i = 0; i < skill.length; i++) {
        ResumeSkill.create({ resumeId: result.resumeId, skill: skill[i] });
      }
    });

    res.status(200).send({ users, message: "나의 정보를 등록 했습니다." });
  } catch (err) {
    console.log(err);
    res.status(400).send({ errormessage: "작성란을 모두 기입해주세요." });
  }
});

// 팀원 찾기 전체 조회
router.get("/", async (req, res) => {
  try {
    const resumes = await Resume.findAll({
      //   // ResumeSkill 모델에서 skill를 찾은 후 resumes 에 담음
      include: [
        {
          model: ResumeSkill,
          attributes: ["skill"],
        },
      ],
      // offset: 3,
      limit: 9, // 하나의 페이지 9개 조회
      order: [["createdAt", "DESC"]],
    });

    const resumeskills = resumes.map((resume) => resume.ResumeSkills.map((skill) => skill["skill"]));

    let returnResumes = [];

    resumes.forEach((resume, index) => {
      let a_resume = {};
      a_resume.resumeId = resume.resumeId;
      a_resume.userId = resume.userId;
      a_resume.nickname = resume.nickname;
      a_resume.resumeImage = resume.resumeImage;
      a_resume.content = resume.content;
      a_resume.start = resume.start;
      a_resume.end = resume.end;
      a_resume.role = resume.role;
      a_resume.resumeskills = resumeskills[index];
      a_resume.createdAt = resume.createdAt;

      returnResumes.push(a_resume);
    });

    res.status(200).send({ returnResumes });
  } catch (error) {
    console.log(error);
    res.status(400).send({});
  }
});

// 팀원 찾기 상세조회
router.get("/:resumeId", async (req, res) => {
  try {
    const { resumeId } = req.params;

    const existresumes = await Resume.findOne({
      include: [
        {
          model: ResumeSkill,
          attributes: ["skill"],
        },
      ],
      where: { resumeId },
    });
    // const skills = projectQuery.ProjectSkills.map(eachSkill => eachSkill.skill);
    const resumeskills = existresumes.ResumeSkills.map((skills) => skills.skill);

    const resumes = {
      resumeId: existresumes.resumeId,
      userId: existresumes.userId,
      nickname: existresumes.nickname,
      content: existresumes.content,
      start: existresumes.start,
      end: existresumes.end,
      role: existresumes.role,
      content2: existresumes.content2,
      content3: existresumes.content3,
      resumeImage: existresumes.resumeImage,
      resumeskills,
    };

    console.log(resumes);
    console.log(resumeskills);
    // console.log(existResume);

    res.status(200).send({ resumes });
  } catch (error) {
    console.log(error);
    res.status(400).send({ errorMessage: "잠시만요" });
  }
});

// 팀원 찾기 정보 수정
router.put("/:resumeId", authMiddleware, async (req, res) => {
  try {
    const { userId } = res.locals.user;
    const { resumeId } = req.params;
    const { content, start, end, role, skill, content2, content3 } = req.body;

    const existResume = await Resume.findOne({ where: { resumeId, userId } });

    if (userId !== existResume.userId) {
      return res.status(400).send({ errormessage: "내 게시글이 아닙니다" });
    } else {
      const tran = await sequelize.transaction(); // 트랙잭션 시작
      try {
        Resume.update({ content, start, end, role, content2, content3, resumeImage }, { where: { resumeId, userId } });
        // 등록 당시의 개수와 수정 당시의 개수가 다르면 update 사용 곤란으로 삭제 후 재등록 처리
        if (skill.length) {
          await ResumeSkill.destroy({ where: { resumeId }, transaction: tran });
          for (let i = 0; i < skill.length; i++) {
            await ResumeSkill.create({ resumeId, skill: skill[i] }, { transaction: tran });
          }
        }
        await tran.commit();
      } catch (error) {
        await tran.rollback(); // 트랜젝션 실패시 시작부분까지 되돌리기
      }
    }
    res.status(200).send({ message: "나의 정보를 수정했습니다." });
  } catch (error) {
    console.log(error);
    res.status(401).send({ errormessage: "작성란을 모두 기입해주세요." });
  }
});

// 팀원 찾기 정보 삭제
router.delete("/:resumeId", authMiddleware, async (req, res) => {
  try {
    const { userId } = res.locals.user;
    const { resumeId } = req.params;

    if (!userId) return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });

    const existResume = await Resume.findOne({ include: [{ model: ResumeSkill, where: { resumeId } }], where: { resumeId, userId } });

    if (userId !== existResume.userId) {
      return res.status(400).send({ errormessage: "내 게시글이 아닙니다" });
    } else {
      // if (existResume.resumeImage === resumeImage) {
      // s3.deleteObject({
      //   bucket: "jerryjudymary",
      //   Key: existResume.resumeImage,
      // });
      await existResume.destroy({});
    }
    // }
    res.status(200).send({ message: "나의 정보를 삭제했습니다." });
  } catch (error) {
    console.log(error);
    res.status(401).send({ errormessage: "작성자만 삭제할 수 있습니다." });
  }
});

module.exports = router;
