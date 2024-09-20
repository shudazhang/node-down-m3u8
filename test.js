const downloadFile = require("./node-down-m3u8.js");

downloadFile({
  href: "https://play.xluuss.com/play/mepZ8Lpb/index.m3u8",
  fileName: "test.mp4",
  ffmpegPath: "D:\\software\\ffmpeg\\bin\\ffmpeg.exe"
})
  .then(() => {
    console.log("下载完成");
  })
  .catch((error) => {
    console.log("下载失败");
  });
