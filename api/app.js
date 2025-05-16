require("dotenv").config();
const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const serverless = require("serverless-http");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

// configure multer
const upload = multer({ dest: "/tmp" }); // must use temp dir on serverless
app.use(express.json({ limit: "10mb" }));

// initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.use(express.static("public"));

// analyze route
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const imagePath = req.file.path;
    const imageData = await fsPromises.readFile(imagePath, { encoding: "base64" });

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "Analyze this plant image and provide detailed analysis of its species, health, and care recommendations, its characteristics, care instructions, and any interesting facts. Please provide the response in plain text without using any markdown formatting.",
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: imageData,
        },
      },
    ]);

    const plantInfo = result.response.text();

    await fsPromises.unlink(imagePath);

    res.json({
      result: plantInfo,
      image: `data:${req.file.mimetype};base64,${imageData}`,
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({ error: "An error occurred while analyzing the image" });
  }
});

// download route
app.post("/download", express.json(), async (req, res) => {
  const { result, image } = req.body;
  try {
    const filePath = `/tmp/plant_analysis_${Date.now()}.pdf`;
    const writeStream = fs.createWriteStream(filePath);
    const doc = new PDFDocument();

    doc.pipe(writeStream);
    doc.fontSize(24).text("Plant Analysis Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(24).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.fontSize(14).text(result, { align: "left" });

    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      doc.moveDown();
      doc.image(buffer, { fit: [500, 300], align: "center", valign: "center" });
    }

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    res.download(filePath, (err) => {
      if (err) res.status(500).json({ error: "Error downloading the PDF report" });
      fsPromises.unlink(filePath);
    });
  } catch (error) {
    console.error("Error generating PDF report:", error);
    res.status(500).json({ error: "An error occurred while generating the PDF report" });
  }
});

// export as serverless handler
module.exports = serverless(app);
