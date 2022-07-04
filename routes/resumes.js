const express = require("express");
const router = express.Router();
const moment = require("moment");
const multer = require("multer");
const { Op } = require("sequelize");
const { resumes } = require("../models/resumes");
const multerS3 = require("multer-s3");
const aws = require("aws-sdk");
const s3 = new aws.S3();
const authMiddleware = require("../middlewares/authMiddleware");
const db = require("../config/database");

// multer - S3 이미지 업로드 설정

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "jerryjudymary",
    acl: "public-read",
    key: function (req, file, cb) {
      cb(null, "projectImage/" + Date.now() + "." + file.originalname.split(".").pop()); // 이름 설정
    },
  }),
});

// 이미지 업로드
router.post("/image", authMiddleware, upload.single("resumeImage"), async (req, res) => {
  try {
    const resumeImage = req.file.location;
    return res.status(200).json({ message: "사진을 업로드 했습니다.", resumeImage });
  } catch (err) {
    console.log(err);
    res.status(400).send({ errorMessage: "사진업로드 실패-파일 형식과 크기(1.5Mb 이하) 를 확인해주세요." });
  }
});

// 팀원 찾기 등록
// router.post("/", authMiddleware, upload.single("resumeImage"), async (req, res) => {
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { userId, nickname } = res.locals.user;
    const { content, phone, start, end, role, skills, content2, content3, resumeImage } = req.body;
    if (!res.locals.user) return res.status(401).send({ errorMessage: "로그인 후 사용하세요." });

    // const resumeImage = req.file.location;
    // 이메일 형식 제한
    const re_email = /^[0-9a-zA-Z]([-_\.]?[0-9a-zA-Z])*@[0-9a-zA-Z]([-_\.]?[0-9a-zA-Z])*\.[a-zA-Z]{2,3}$/i;
    // 숫자(2~3자리) - 숫자(3~4자리) - 숫자(4자리)
    const re_phone = /^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}/;

    if (email.search(re_email) == -1) return res.status(400).send({ errormessage: "이메일 형식이 아닙니다." });
    if (phone.search(re_phone) == -1) return res.status(400).send({ errormessage: "숫자(2~3자리) - 숫자(3~4자리) - 숫자(4자리)" });

    const createdAt = moment().format("YYYY-MM-DD hh:mm:ss");

    const skillsStr = JSON.stringify(skills);
    const imageStr = JSON.stringify(resumeImage);

    // console.log(imageStr);
    if (typeof imageStr == "undefined") throw error; // type이 undefined 시 error 예외 처리

    await resumes.create({ userId, nickname, content, phone, start, end, role, skillsStr, content2, content3, imageStr, createdAt });

    res.status(200).send({ message: "나의 정보를 등록 했습니다." });
  } catch (error) {
    console.log(error);
    res.status(400).send({ errormessage: "작성란을 모두 기입해주세요." });
  }
});

// 팀원 찾기 전체 조회
router.get("/", async (req, res) => {
  try {
    await db.query("SELECT * FROM resumes", (error, result, fields) => {
      if (error) {
        throw error;
      } else {
        let resumes = [];

        for (let i = 0; i < result.length; i++) {
          const resumesRaw = result[i];
          const { name, resumeImage, content, start, end, role, createdAt } = resumesRaw;

          // moment 라이브러리를 활용하여 날짜 포멧 형식 지정
          const start_moment = moment(start).format("YYYY-MM-DD");
          const end_moment = moment(end).format("YYYY-MM-DD");
          const createdAt_moment = moment(createdAt).format("YYYY-MM-DD hh:mm:ss");

          const skills = JSON.parse(resumesRaw.skills);
          // const resumeImage = JSON.parse(resumesRaw.resumeImage);

          const resume = { name, resumeImage, content, start_moment, end_moment, role, skills, createdAt_moment };
          // const resume = { content, email, phone, start_moment, end_moment, role, content2, content3, skills, userId, createdAt_moment };
          resumes.push(resume);
        }
        res.status(200).send({ resumes });
      }
    });
  } catch (error) {
    console.log(error);
    res.status(400).send({});
  }
});

// 팀원 찾기 상세조회
router.get("/:resumeId", authMiddleware, async (req, res) => {
  try {
    const { resumeId } = req.params;
    if (!res.locals.user) return res.status(401).send({ errorMessage: "로그인 후 사용하세요." });

    await db.query(`SELECT * FROM resumes WHERE resumeId = ${resumeId}`, (error, result, fields) => {
      if (error) throw error;
      const [resumeRaw] = result;
      const { name, content, email, phone, start, end, role, content2, content3 } = resumeRaw;

      // moment 라이브러리를 활용하여 날짜 Format 형식
      const start_moment = moment(start).format("YYYY-MM-DD");
      const end_moment = moment(end).format("YYYY-MM-DD");

      const skills = JSON.parse(resumeRaw.skills);
      const resumeImages = JSON.parse(resumeRaw.resumeImage);

      // const resume = { content, email, phone, start_moment, end_moment, role, content2, content3, skills, userId, createdAt_moment };
      const resume = { name, resumeImages, content, email, phone, start_moment, end_moment, role, content2, content3, skills };
      res.status(200).send({ resume });
    });
  } catch (error) {
    console.log(error);
    res.status(400).send({});
  }
});

// 팀원 찾기 정보 수정
// router.put("/:resumeId", authMiddleware, upload.single("resumeImage"), async (req, res) => {
router.put("/:resumeId", authMiddleware, async (req, res) => {
  try {
    const { resumeId } = req.params;
    const { name, content, email, phone, start, end, role, skills, content2, content3, resumeImage } = req.body;

    if (!res.locals.user) return res.status(401).send({ errorMessage: "로그인 후 사용하세요." });
    // const existResum = await Resume.findById(resumeId);

    const existResumid = `SELECT * FROM resumes WHERE userId = '${userId}'`;

    await db.query(existResumid, (error, result, fields) => {
      if (error) throw error;
      const [existResume] = result;

      if (userId !== existResume.userId) {
        return res.status(400).send({ errormessage: "내 게시글이 아닙니다" });
      } else {
        const skillsStr = JSON.stringify(skills);
        const imageStr = JSON.stringify(resumeImage);

        const Resumesput = `UPDATE resumes SET name = '${name}', content = '${content}', email = '${email}', phone = '${phone}', start = '${start}', end = '${end}',
        role='${role}', skills='${skillsStr}', content2='${content2}', content3='${content3}',resumeImage='${imageStr}',WHERE resumeId = '${resumeId}' AND userId = '${userId}'`;
        // role = '${role}', skills = '${skillsStr}', content2 = '${content2}', content3 = '${content3}', resumeImage = '${null}' WHERE resumeId = '${resumeId}' AND userId = '${userId}'`;

        db.query(Resumesput, (error, result, fields) => {
          if (error) throw error;
          res.status(200).send({ message: "나의 정보를 수정했습니다." });
        });
        // await Resume.findByIdAndUpdate(resumeId, { $set: { nickname, name, content, email, phone, start_date, end_date, role, skills, content2, content3, resumeImage } });
      }
    });
  } catch (error) {
    console.log(error);
    res.status(401).send({ errormessage: "작성란을 모두 기입해주세요." });
  }
});

// // 팀원 찾기 정보 프로필 이미지 수정
// router.put("/:resumeId/profileImage", authMiddleware, upload.single("profileImage"), async (req, res) => {
//   try {
//   } catch (error) {}
// });
// // 팀원 찾기 정보 프로필 이미지 삭제
// router.delete("/:resumeId/profileImage", authMiddleware, async (req, res) => {
//   try {
//   } catch (error) {}
// });

// 팀원 찾기 정보 삭제
router.delete("/:resumeId", authMiddleware, async (req, res) => {
  try {
    const { resumeId } = req.params;
    const { userId } = res.locals.user;
    const existResumid = `SELECT * FROM resumes WHERE userId = '${userId}'`;

    if (!res.locals.user) return res.status(401).json({ errorMessage: "로그인 후 사용하세요." });

    await db.query(existResumid, (error, result, fields) => {
      if (error) throw error;
      const [existResum] = result;

      if (userId !== existResum.userId) {
        return res.status(400).send({ errormessage: "내 게시글이 아닙니다" });
      } else {
        const existResumdel = `DELETE FROM resumes WHERE resumeId = ${resumeId}`;

        // if (existResum.resumeImage === resumeImage) {
        //   s3.deleteObject({
        //     bucket: "jerryjudymary",
        //     Key: existResum.resumeImage,
        //   });
        //   const resumeImage = `DELETE FROM resumes WHERE resumeImage = ${resumeImage}`;
        // }

        db.query(existResumdel, (error, result, fields) => {
          if (error) throw error;
          res.status(200).send({ message: "나의 정보를 삭제했습니다." });
        });
        // await Resume.findByIdAndDelete(resumeId);
      }
    });
  } catch (error) {
    console.log(error);
    res.status(401).send({ errormessage: "작성자만 삭제할 수 있습니다." });
  }
});

module.exports = router;
