const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

// 导出函数，使其可供其他模块调用
module.exports = function (options) {
  return new Promise((resolve, reject) => {
    startDownFunc({
      ...options,
      onError: (err) => {
        reject(err);
      },
      onSuccess: () => {
        resolve();
      },
    });
  });
};

// 当脚本作为主模块执行时，以下代码块将被激活
if (!module.parent) {
  // 获取命令行中所有以 '--' 开头的参数
  let argvList = process.argv.filter((item) => item.startsWith("--"));

  // 如果存在自定义参数
  if (argvList.length > 0) {
    // 初始化一个对象用于存储解析后的参数键值对
    let result = {};

    // 遍历所有自定义参数
    argvList.forEach((item) => {
      // 解析参数名，移除 '--' 后分割字符串取第一部分作为键名
      let key = item.replace("--", "").split("=")[0];
      // 解析参数值，移除 '--' 后按等号分割字符串取第二部分作为键值
      let value = item.replace("--", "").split("=")[1];
      if (value === "true" || value === "false") {
        value = value === "true" ? true : false;
      }
      if (key === "headers") {
        // value = JSON.parse(value);
        value = value.split(",").reduce((acc, cur) => {
          let [key, value] = cur.split(":");
          acc[key] = value;
          return acc;
        }, {});
      }
      // 将解析出的键值对存入结果对象
      result[key] = value;
    });
    // 使用解析后的参数对象调用下载启动函数
    startDownFunc(result);
  }
}

async function startDownFunc(opts = {}) {
  try {
    // 初始化下载选项
    var options = {
      href: "", // 下载文件地址
      headers: {}, // 请求头
      timeout: 60 * 1000, // 超时时间
      poolCount: 5, //并发下载数
      retry: 10, // 重试最大次数
      fileName: opts.fileName || path.parse(opts.href).base, // 下载文件名
      fileDir: opts.fileDir || "./", // 下载文件目录
      cacheDir: path.join(
        // 缓存文件目录
        opts.fileDir || "./",
        (opts.fileName && path.parse(opts.fileName).name) || path.parse(opts.href).name
      ),
      cacheDbName: "00.json", // 缓存数据文件名
      isCache: true, // 是否使用缓存。默认:true, 可选[true,false]
      oldM3u8FileName: "old_index.m3u8", //内容与线上内容一致
      newM3u8FileName: "new_index.m3u8", // 内容改为网络连接
      localM3u8FileName: "local_index.m3u8", // 内容改为本地连接
      isWriteLog: true, // 是否开启日志
      logDir: "log", // 日志目录
      logFileName: "log.txt", // 日志文件
      isConsole: true, // 是否开启控制台日志
      onError: onErrorFunc, // 错误回调
      onSuccess: onSuccessFunc, // 成功回调
      onProgress: onProgressFunc, // 进度回调
      taskList: [], //  任务列表
      ...opts,
    };

    // 合并缓存相关的配置选项
    options = {
      ...options,
      ...getCacheDataFunc(options.isCache, options.cacheDir, options.cacheDbName),
    };

    // 记录开始下载的日志
    writeLogFunc(`开始下载:${options.href}`, options.isWriteLog, options.logDir, options.logFileName, options.isConsole);

    // 创建文件保存目录
    await createFolderFunc(options.fileDir);

    // 创建缓存文件保存目录
    await createFolderFunc(options.cacheDir);

    // 下载m3u8文件
    await downOldM3u8Func(options.href, options.headers, path.join(options.cacheDir, options.oldM3u8FileName));

    // 获取旧的m3u8数据
    let oldM3u8Data = fs.readFileSync(path.join(options.cacheDir, options.oldM3u8FileName), "utf8");

    let newM3u8Href = options.href;

    // 如果m3u8文件包含其他m3u8文件，则下载该文件
    while (oldM3u8Data.includes(".m3u8")) {
      let m3u8Href = oldM3u8Data.split("\n").find((item) => item.includes(".m3u8"));
      if (m3u8Href.startsWith("http")) {
        newM3u8Href = m3u8Href;
      } else if (m3u8Href.startsWith("/")) {
        newM3u8Href = new URL(newM3u8Href).origin + m3u8Href;
      } else {
        newM3u8Href = path.parse(newM3u8Href).dir + "/" + m3u8Href;
      }
      await downOldM3u8Func(newM3u8Href, options.headers, path.join(options.cacheDir, options.oldM3u8FileName));
      oldM3u8Data = fs.readFileSync(path.join(options.cacheDir, options.oldM3u8FileName), "utf8");
    }

    // 获取新的m3u8数据
    let newM3u8Data = getNewM3u8DataFunc(oldM3u8Data, newM3u8Href);

    // 将m3u8数据写入文件
    fs.writeFileSync(path.resolve(options.cacheDir, options.newM3u8FileName), newM3u8Data);

    // 获取本地m3u8数据
    let localM3u8Data = getLocalM3u8DataFunc(newM3u8Data);

    // 将m3u8数据写入文件
    fs.writeFileSync(path.resolve(options.cacheDir, options.localM3u8FileName), localM3u8Data);

    // 获取任务列表
    options.taskList = uniqueByValue(getTaskListCacheFunc(options.taskList) || getTaskListChunkFunc(newM3u8Data, options.cacheDir), "href");

    // 初始化下载线程池
    var poolList = [];
    for (let poolIndex = 0; poolIndex < options.poolCount; poolIndex++) {
      loopGetActiveTaskFunc(options, poolList, poolIndex);
    }
  } catch (error) {
    // 错误处理，调用错误回调函数并记录错误日志
    options.onError(error);
    writeLogFunc(error.message, options.isWriteLog, options.logDir, options.logFileName, options.isConsole);
  }
}

/**
 * 异步循环获取活跃任务的函数。
 * 该函数旨在管理任务的下载过程，包括检查所有任务是否完成、处理重试逻辑、启动新任务等。
 * @param {Object} options - 任务配置选项，包含任务列表、缓存目录、本地M3u8文件名、文件目录、文件名、成功回调、错误回调、日志记录等。
 * @param {Array} poolList - 连接池列表，用于管理请求实例和定时器。
 * @param {number} poolIndex - 当前连接池的索引。
 */
async function loopGetActiveTaskFunc(options, poolList, poolIndex) {
  try {
    // 检查所有任务是否已完成
    let isAllFinish = options.taskList.every((item) => item.status === "finish");
    if (isAllFinish) {
      // 所有任务完成，执行合并和清理操作，并调用成功回调
      await ffmpegMerge(path.resolve(options.cacheDir, options.localM3u8FileName), path.resolve(options.fileDir, options.fileName));
      deleteFolderFunc(options.cacheDir);
      options.onSuccess();
      writeLogFunc("下载完成", options.isWriteLog, options.logDir, options.logFileName, options.isConsole);
      return;
    }

    // 遍历任务列表，检查是否有任务重试次数达到最大值
    for (let taskIndex = 0; taskIndex < options.taskList.length; taskIndex++) {
      if (options.taskList[taskIndex].retry >= options.retry) {
        // 重试次数达到最大值，清理连接池并调用错误回调
        poolList.forEach((item) => {
          if (item.req && item.req.destroy) {
            item.req.destroy();
          }
          if (item.timer) {
            clearTimeout(item.timer);
            item.timer = null;
          }
          item.req = null;
        });
        options.onError({ message: "重连次数达到最大值" });
        writeLogFunc("重连次数达到最大值", options.isWriteLog, options.logDir, options.logFileName, options.isConsole);
        return;
      }
    }

    // 查找状态为"init"的活跃任务
    let activeTask = options.taskList.find((item) => item.status === "init");

    // 如果没有活跃任务，则结束函数
    if (!activeTask) {
      return;
    }

    // 准备活跃任务，重置其状态和下载大小，并清理当前连接池的定时器和请求
    activeTask.status = "starting";
    activeTask.downSize = 0;
    poolList[poolIndex] && poolList[poolIndex].timer && clearTimeout(poolList[poolIndex].timer);
    poolList[poolIndex] && poolList[poolIndex].req && poolList[poolIndex].req.destroy();
    poolList[poolIndex] = {
      req: "",
      activeTask,
      timer: null,
    };

    // 创建任务文件的目录，并初始化任务文件和缓存数据库
    await createFolderFunc(path.parse(activeTask.path).dir);
    fs.writeFileSync(activeTask.path, Buffer.alloc(0));
    fs.writeFileSync(path.join(options.cacheDir, options.cacheDbName), JSON.stringify(options));

    try {
      // 执行下载函数，更新任务状态
      await downloaderFunc(activeTask, options.headers, poolList[poolIndex], options.taskList, options.onProgress, options.timeout);
      if (fs.statSync(activeTask.path).size == activeTask.fileSize) {
        activeTask.status = "finish";
      } else {
        activeTask.retry++;
        activeTask.status = "init";
        activeTask.downSize = 0;
      }
    } catch (error) {
      // 下载出错，增加重试次数，重置状态和下载大小，以便下一次重试
      activeTask.retry++;
      activeTask.status = "init";
      activeTask.downSize = 0;
    }

    // 递归调用自身，继续管理下一个活跃任务
    loopGetActiveTaskFunc(options, poolList, poolIndex);
  } catch (error) {
    // 出现任何错误，调用错误回调，并记录错误日志
    options.onError(error);
    writeLogFunc(error.message, options.isWriteLog, options.logDir, options.logFileName, options.isConsole);
  }
}
/**
 * 下载器函数，用于处理特定任务的下载操作。
 * 该函数返回一个Promise，表示下载操作的完成或失败。
 *
 * @param {Object} activeTask 当前活跃的下载任务对象，包含href、path等信息。
 * @param {Object} headers HTTP请求头。
 * @param {Object} poolItem 下载池中的项，用于管理下载任务的相关资源，如请求对象和超时计时器。
 * @param {Array} taskList 下载任务列表。
 * @param {Function} onProgress 进度更新回调函数，传入任务列表以更新进度。
 * @param {number} timeout 下载超时时间，单位为毫秒。
 * @returns {Promise} 表示下载操作完成或失败的Promise对象。
 */
function downloaderFunc(activeTask, headers, poolItem, taskList, onProgress, timeout) {
  return new Promise((resolve, reject) => {
    try {
      // 解析任务的URL，以获取请求所需的协议、主机名等信息。
      var hrefObj = new URL(activeTask.href);

      // 根据URL的协议选择http或https模块。
      const protocol = hrefObj.protocol === "https:" ? https : http;

      // 设置下载超时处理，超过指定时间后拒绝Promise。
      poolItem.timer = setTimeout(() => {
        poolItem.req && poolItem.req.destroy && poolItem.req.destroy();
        reject(new Error("下载超时"));
      }, timeout);

      // 发起HTTP请求。
      poolItem.req = protocol.request(
        {
          hostname: hrefObj.hostname,
          port: hrefObj.port,
          path: hrefObj.pathname,
          method: "GET",
          headers: headers,
          search: hrefObj.search,
        },
        (res) => {
          // 清除超时计时器。
          clearTimeout(poolItem.timer);
          poolItem.timer = null;
          // 设置下载超时处理，超过指定时间后拒绝Promise。
          poolItem.timer = setTimeout(() => {
            poolItem.req && poolItem.req.destroy && poolItem.req.destroy();
            reject(new Error("下载超时"));
          }, timeout);
          // 更新当前任务的文件大小信息。
          activeTask.fileSize = res.headers["content-length"];
          activeTask.retry = 0;
          // 创建写入流，用于将下载的数据写入文件。
          const fileStream = fs.createWriteStream(activeTask.path, { flags: "w+" });
          // 管道将响应数据流导向文件流。
          res.pipe(fileStream);
          // 监听数据事件，更新下载进度。
          res.on("data", (chunk) => {
            activeTask.downSize += chunk.length;
            onProgress(taskList);
          });
          // 监听结束事件，表示下载完成。
          res.on("end", () => {
            clearTimeout(poolItem.timer);
            poolItem.timer = null;
            resolve();
          });
        }
      );
      // 监听请求错误，发生错误时拒绝Promise。
      poolItem.req.on("error", async (error) => {
        clearTimeout(poolItem.timer);
        poolItem.timer = null;
        reject(error);
      });
      // 结束请求。
      poolItem.req.end();
    } catch (error) {
      console.log(error);
    }
  });
}

/**
 * 使用ffmpeg合并视频文件。
 *
 * 该函数通过调用ffmpeg命令行工具来合并指定输入路径(inPath)的视频文件到指定输出路径(outPath)。
 * 它首先检查输出路径是否已存在，如果存在，则删除该文件以避免覆盖问题。
 * 然后，它Spawn一个ffmpeg进程来执行合并操作，并通过stdout和stderr监听ffmpeg的输出。
 * 当ffmpeg进程结束后，无论成功与否，都会通过Promise的resolve或reject来通知调用者。
 *
 * @param {string} inPath 输入视频文件的路径。
 * @param {string} outPath 输出合并后视频文件的路径。
 * @returns {Promise} 表示ffmpeg合并操作完成的Promise对象。
 */
function ffmpegMerge(inPath, outPath) {
  return new Promise((resolve, reject) => {
    // 检查输出文件是否已存在，如果存在，则删除它
    if (fs.existsSync(outPath)) {
      fs.unlinkSync(outPath);
    }
    // 使用ffmpeg命令行工具合并视频，指定输入输出参数
    const ls = spawn("ffmpeg", ["-allowed_extensions", "ALL", "-i", `${inPath}`, "-c", "copy", "-threads", "4", `${outPath}`]);
    // 监听ffmpeg的标准输出，用于日志记录
    ls.stdout.on("data", (data) => {
      console.log(data.toString());
    });
    // 监听ffmpeg的标准错误输出，用于错误处理和日志记录
    ls.stderr.on("data", (data) => {
      console.log(data.toString());
    });
    // 当ffmpeg进程结束时，无论成功还是失败，都通过resolve来解决Promise
    ls.on("close", (code) => {
      resolve();
    });
  });
}
/**
 * 根据指定的键值去重数组中的对象。
 *
 * @param {Array} array - 要处理的数组，数组中的每个元素都是一个对象。
 * @param {string} key - 对象中的键，用以识别对象的唯一性。
 * @returns {Array} - 返回一个新的数组，其中包含了根据指定键值去重后的对象。
 */
function uniqueByValue(array, key) {
  // 使用Set数据结构来存储已经出现过的键值，以确保唯一性。
  const set = new Set();
  // 初始化结果数组，用于存储去重后的对象。
  const result = [];
  // 遍历输入数组中的每个对象。
  for (let i = 0; i < array.length; i++) {
    // 获取当前对象的指定键的值。
    const value = array[i][key];
    // 如果当前值还没有出现在Set中，则将其添加到Set和结果数组中。
    if (!set.has(value)) {
      set.add(value);
      result.push(array[i]);
    }
  }
  // 返回去重后的结果数组。
  return result;
}
/**
 * 处理M3u8数据，优化URL引用。
 *
 * 该函数接收一个新的M3u8播放列表数据字符串，通过对数据进行特定处理，返回一个修改后的M3u8数据字符串。
 * 主要处理包括：提取并转换URI引用，确保URI以相对路径的形式存在，便于后续处理和使用。
 *
 * @param {string} newM3u8Data - 新的M3u8数据字符串。
 * @returns {string} - 处理后的M3u8数据字符串。
 */
function getLocalM3u8DataFunc(newM3u8Data) {
  // 将M3u8数据字符串按行分割为数组
  return (
    newM3u8Data
      .split("\n")
      .map((item) => {
        // 处理包含URI的行，提取URI并去除引号，如果不存在URI则使用原行
        let tmpHref = (item.includes("URI=") && item.split("URI=")[1] && item.split("URI=")[1].replace('"', "")) || item;
        // 如果tmpHref以http开头，将其转换为相对路径
        if (tmpHref && tmpHref.startsWith("http")) {
          item = item.replace(tmpHref, new URL(tmpHref).pathname.slice(1)).replace(/%22/g, '"');
        }
        return item;
      })
      // 将处理后的行数组重新合并为字符串
      .join("\n")
  );
}
/**
 * 根据任务列表更新缓存函数
 * 该函数接收一个任务列表作为参数，检查每个任务的状态，并根据文件是否存在、文件大小是否匹配来更新任务的状态。
 * 如果文件存在且大小匹配，任务状态将被设置为"finish"，同时记录文件大小。
 * 如果文件不存在或大小不匹配，任务状态将被重置为"init"，重试次数和已下载大小将被重置。
 *
 * @param {Array} taskList - 任务列表，每个任务包含路径、状态、文件大小等信息。
 * @returns {Array} - 返回更新后的任务列表，每个任务的状态和已下载大小可能已更新。
 */
function getTaskListCacheFunc(taskList) {
  // 检查任务列表是否为非空数组
  if (Array.isArray(taskList) && taskList.length > 0) {
    // 遍历任务列表，对每个任务进行状态更新
    return taskList.map((item) => {
      // 检查文件是否存在，以及文件大小是否与预期匹配
      if (fs.existsSync(item.path) && item.status === "finish" && fs.statSync(item.path).size == item.fileSize) {
        // 如果条件满足，保持状态为"finish"，并更新已下载大小
        item.status = "finish";
        item.downSize = item.fileSize;
      } else {
        // 如果条件不满足，重置状态为"init"，重试次数为0，已下载大小为0
        item.status = "init";
        item.retry = 0;
        item.downSize = 0;
      }
      // 返回更新后的任务项
      return item;
    });
  }
}

/**
 * 根据新的M3u8数据和缓存目录，获取任务列表的函数。
 * 该函数解析M3u8文件内容，筛选出其中的URI任务项，并为每个任务初始化状态。
 *
 * @param {string} newM3u8Data 新的M3u8文件数据。
 * @param {string} cacheDir 缓存目录的路径，用于存储下载的文件。
 * @returns {Array} 返回一个包含每个任务信息的对象数组，每个对象包含任务的索引、链接、状态等信息。
 */
function getTaskListChunkFunc(newM3u8Data, cacheDir) {
  // 将M3u8数据分割成行，并过滤掉空行和非URI行。
  return newM3u8Data
    .split("\n")
    .filter((item) => item.includes("URI=") || (!item.startsWith("#") && item.trim() !== ""))
    .map((item, index) => {
      // 解析URI，移除引号，并处理无法解析为URI的行。
      let tmpHref = (item.includes("URI=") && item.split("URI=")[1] && item.split("URI=")[1].replace('"', "")) || item;
      if (item.includes("URI=")) {
        tmpHref = /URI="(.+?)"/.exec(item)[1];
      } else {
        tmpHref = item;
      }
      // 返回每个任务的详细信息，包括索引、链接、初始状态等。
      return {
        index,
        href: tmpHref,
        status: "init",
        retry: 0,
        downSize: 0,
        fileSize: 0,
        path: path.join(cacheDir, new URL(tmpHref).pathname),
      };
    });
}

/**
 * 根据新的M3u8链接更新旧的M3u8数据。
 * 这个函数处理旧的M3u8字符串，更新其中的URI引用，确保它们指向新的位置。
 *
 * @param {string} oldM3u8Data 旧的M3u8数据字符串。
 * @param {string} newM3u8Href 新的M3u8文件的URL，用于更新旧数据中的相对路径。
 * @returns {string} 返回更新后的M3u8数据字符串。
 */
function getNewM3u8DataFunc(oldM3u8Data, newM3u8Href) {
  // 将旧的M3u8数据字符串按行分割成数组
  return (
    oldM3u8Data
      .split("\n")
      // 对每一行进行处理，映射到新的数组中
      .map((item) => {
        // 检查行中是否包含URI关键字，用于识别媒体文件的引用
        if (item.includes("URI=")) {
          // 使用URI关键字分割字符串，以获取URI的引用部分
          let uriList = item.split('URI="');
          // 如果URI不是以http开头，说明它是相对路径
          if (!uriList[1].startsWith("http")) {
            // 如果URI以斜杠开头，说明它是根相对路径，需要拼接新的URL起源
            if (uriList[1].startsWith("/")) {
              uriList[1] = new URL(newM3u8Href).origin + uriList[1];
            } else {
              // 如果URI不是根相对路径，需要拼接新的URL目录
              uriList[1] = path.parse(newM3u8Href).dir + "/" + uriList[1];
            }
          }
          // 重新组合URI引用，并更新当前行
          item = uriList[0] + 'URI="' + uriList[1];
        } else if (!item || item.startsWith("#")) {
          // 如果行是空的或者以井号开头（注释），则不做处理
          item = item;
        } else if (!item.startsWith("http")) {
          // 如果行不是以http开头，说明可能是相对路径的媒体文件
          // 处理逻辑同上，对非URI行进行路径更新
          if (item.startsWith("/")) {
            item = new URL(newM3u8Href).origin + item;
          } else {
            item = path.parse(newM3u8Href).dir + "/" + item;
          }
        }
        // 返回处理后的行
        return item;
      })
      // 将处理后的行数组重新合并成字符串，以换行符分隔
      .join("\n")
  );
}

/**
 * 下载旧版M3u8文件的函数。
 * 该函数通过发送HTTP请求来下载指定的M3u8文件，并将其保存到本地文件系统。
 *
 * @param {string} href - M3u8文件的URL地址。
 * @param {Object} headers - 请求所需的HTTP头部信息。
 * @param {string} oldM3u8FilePath - 保存M3u8文件的本地文件路径。
 * @returns {Promise} - 表示异步下载操作的Promise对象，成功时解析为undefined，失败时拒绝并返回错误。
 */
function downOldM3u8Func(href, headers, oldM3u8FilePath) {
  return new Promise((resolve, reject) => {
    try {
      // 解析URL以获取请求所需的细节信息
      var hrefObj = new URL(href);

      // 根据URL的协议选择http或https模块
      const protocol = hrefObj.protocol === "https:" ? https : http;

      // 创建HTTP请求对象
      const req = protocol.request(
        {
          hostname: hrefObj.hostname,
          port: hrefObj.port,
          path: hrefObj.pathname,
          method: "GET",
          headers: headers,
          search: hrefObj.search,
        },
        (res) => {
          // 创建写入流，用于将响应数据写入到本地文件
          const fileStream = fs.createWriteStream(oldM3u8FilePath, { flags: "w+" });
          // 管道将响应数据流式传输到文件流
          res.pipe(fileStream);
          // 在写入流完成后，解析Promise表示下载成功
          fileStream.on("finish", () => {
            resolve();
          });
          // 处理响应的数据事件（在此处为空操作），可用于监控数据进度
          res.on("data", (chunk) => {});
          // 处理响应的结束事件（在此处为空操作），确保所有数据都被处理
          res.on("end", () => {});
        }
      );

      // 处理请求的错误事件，拒绝Promise并返回错误
      req.on("error", async (error) => {
        reject(error);
      });
      // 结束请求
      req.end();
    } catch (error) {
      // 捕获任何尝试过程中抛出的异常，拒绝Promise并返回错误
      reject(error);
    }
  });
}

/**
 * 处理错误的函数
 *
 * 当发生错误时，此函数被调用。它提供了一个地方来处理错误，例如记录错误、显示错误消息或进行一些恢复操作。
 * 不同的应用可能会有不同的错误处理策略，这个函数提供了灵活性来实现这些策略。
 *
 * @param {Error} error 错误对象，包含有关错误的详细信息。可以使用error对象来获取错误的堆栈跟踪、错误消息等。
 *
 * 注意：这个函数体是空的，但在实际应用中，可能会包含对错误的处理逻辑。
 */
function onErrorFunc(error) {}

/**
 * 成功处理函数
 *
 * 该函数定义了成功处理时的回调操作。在实际应用中，它应该被用于处理成功状态下的逻辑，例如数据的展示、用户界面的更新等。
 * 由于当前函数体为空，它没有执行任何具体操作。在实际使用中，应根据具体需求填充函数体。
 *
 * @returns {void} 该函数没有返回值。
 */
function onSuccessFunc() {}

/**
 * 进度条更新函数
 *
 * 本函数用于根据任务列表的完成情况更新进度条。它通过计算所有任务的已完成下载大小和总大小，
 * 来确定进度条应该显示的进度。
 *
 * @param {Array} taskList - 任务列表，每个任务对象包含下载的开始和结束位置以及已下载的大小。
 */
function onProgressFunc(taskList) {
  // 获取所有任务的结束位置，用于确定总任务大小
  let allSize = taskList.length;

  // 累加计算所有任务已完成的下载大小
  let allDownSize = taskList.filter((item) => item.status === "finish").length;

  // 调用进度条显示函数，传入已完成大小和总大小
  processBarFunc(allDownSize, allSize);
}

/**
 * 写入日志的函数。
 * 根据参数决定是否在控制台输出日志内容，并根据配置将日志写入文件。
 *
 * @param {string} logContent - 需要记录的日志内容。
 * @param {boolean} isWriteLog - 是否将日志写入文件。
 * @param {string} logDir - 日志文件的存储目录。
 * @param {string} logFileName - 日志文件的名称。
 * @param {boolean} isConsole - 是否在控制台输出日志。
 */
function writeLogFunc(logContent, isWriteLog, logDir, logFileName, isConsole) {
  // 如果配置为在控制台输出日志，则打印日志内容
  if (isConsole) {
    console.log(logContent);
  }
  // 如果配置为写入日志文件，则调用日志写入函数
  if (isWriteLog) {
    logFunc(logContent, logFileName, logDir);
  }
}

/**
 * 获取缓存数据
 * @param {boolean} isCache  是否开启缓存
 * @param {string} cacheDir  缓存目录
 * @param {string} cacheDbName 缓存数据文件名称
 * @returns
 */
function getCacheDataFunc(isCache, cacheDir, cacheDbName) {
  var cacheData = {};
  try {
    let cacheDbPath = path.resolve(cacheDir, cacheDbName);
    if (isCache && fs.existsSync(cacheDbPath)) {
      cacheData = JSON.parse(fs.readFileSync(cacheDbPath, "utf8"));
    }
  } catch (error) {
    fs.unlinkSync(cacheDbPath);
  }
  return cacheData;
}

/**
 * 异步删除给定路径的文件夹。
 * 如果文件夹不存在，则不执行任何操作。
 * 此函数递归处理文件夹内的子文件夹和文件，确保整个文件夹结构被删除。
 *
 * @param {string} folderPath - 要删除的文件夹的路径。
 * @throws 如果删除过程中遇到任何问题，将抛出错误。
 */
async function deleteFolderFunc(folderPath) {
  try {
    // 检查文件夹是否存在，如果不存在则直接返回
    if (!fs.existsSync(folderPath)) {
      return;
    }

    // 读取文件夹内的所有文件和子文件夹
    const files = await fs.promises.readdir(folderPath);
    // 对文件夹内的每个项进行处理，如果是文件则删除，如果是文件夹则递归调用本函数
    await Promise.all(
      files.map(async (file) => {
        const curPath = path.join(folderPath, file);
        try {
          // 获取当前项的统计信息，以判断是文件还是文件夹
          const stats = await fs.promises.lstat(curPath);
          // 如果是文件夹，则递归调用本函数
          if (stats.isDirectory()) {
            await deleteFolderFunc(curPath);
          } else {
            // 如果是文件，则直接删除
            await fs.promises.unlink(curPath);
          }
        } catch (error) {
          // 如果在处理过程中发生错误，则抛出
          throw error;
        }
      })
    );

    // 在所有文件和子文件夹处理完毕后，尝试删除空文件夹
    try {
      await fs.promises.rmdir(folderPath);
    } catch (error) {
      // 如果删除文件夹失败，则抛出错误
      throw error;
    }
  } catch (error) {
    // 如果在删除过程中发生任何错误，则抛出新错误，包含错误消息
    throw new Error(`删除文件夹失败:${error.message}`);
  }
}

/**
 * 创建一个目录的函数，如果目录已存在，则不进行任何操作。
 *
 * @param {string} dirPath - 需要创建的目录的路径。
 * @returns {Promise} 返回一个Promise对象，表示目录创建操作的结果。
 */
function createFolderFunc(dirPath) {
  return new Promise((resolve, reject) => {
    try {
      // 将传入的路径解析为绝对路径
      const dir = path.resolve(dirPath);
      // 检查目录是否存在，如果不存在则创建目录
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 目录创建成功，调用resolve
      resolve();
    } catch (error) {
      // 目录创建失败，调用reject并传递错误信息
      reject(new Error(`创建目录失败：${error.message}`));
    }
  });
}

/**
 * 记录日志函数
 * 该函数用于向指定的目录中的日志文件写入日志信息。如果目录或日志文件不存在，则会创建它们。
 * @param {string} logContent - 要写入的日志内容，默认为空字符串。
 * @param {string} logFileName - 日志文件名，默认为"log.txt"。
 * @param {string} logDir - 日志文件所在的目录，默认为"log"。
 */
function logFunc(logContent = "", logFileName = "log.txt", logDir = "log") {
  // 检查日志目录是否存在，如果不存在则创建
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  // 检查日志文件是否存在，如果不存在则创建一个新文件并写入当前日期和"新建log文件"信息
  if (!fs.existsSync(path.join(logDir, logFileName))) {
    fs.writeFileSync(path.join(logDir, logFileName), `${currentDateFunc()}==新建log文件\n`);
  }
  // 向日志文件追加当前日期和日志内容
  fs.appendFileSync(path.join(logDir, logFileName), `${currentDateFunc()}==${logContent}\n`);
}

/**
 * 根据当前和总进度生成进度条字符串。
 * 进度条是一个可视化表示当前进度的方式，通过在控制台输出一个等于号（=）和短横线（-）组成的字符串来模拟进度条。
 *
 * @param {number} processBarCurrentSize 当前进度的大小，默认为0。
 * @param {number} processBarTotalSize 总进度的大小，默认为100。
 */
function processBarFunc(processBarCurrentSize = 0, processBarTotalSize = 100) {
  // 定义进度条的长度，默认为20个字符
  let processBarLength = 20;
  // 计算当前进度的百分比，结果向下取整
  let processBarCurrentPercent = ((processBarCurrentSize / processBarTotalSize) * 100).toFixed(2);
  // 根据当前进度的百分比计算进度条中已填充的部分的长度。
  // 如果当前进度小于总进度，进度条长度按比例计算；否则，进度条长度为最大值
  let processBarCurrentBarLength = processBarCurrentSize < processBarTotalSize ? Math.floor((processBarCurrentPercent / 100) * processBarLength) : processBarLength;
  // 构建进度条字符串，使用等于号（=）表示已填充的部分，短横线（-）表示未填充的部分。
  let processBarCurrentBar = `[${[...new Array(processBarCurrentBarLength).fill("="), ...new Array(processBarLength - processBarCurrentBarLength).fill("-")].join("")}]`;
  // 在控制台输出当前的进度条字符串，使用回车换行符（\r）来实现动态更新进度条。
  process.stdout.write(`\r ${processBarCurrentBar} ${processBarCurrentPercent}% `);
}

/**
 * 获取当前日期和时间的字符串表示。
 *
 * 该函数用于生成一个格式为`YYYY-MM-DD HH:MM:SS`的字符串，表示当前的日期和时间。
 * 使用`Date`对象和其方法来获取年、月、日、小时、分钟和秒的值，并通过字符串模板拼接这些值。
 * 为了确保日期和时间的每一位都是两位数，使用了`padStart`方法来在数字前补0。
 *
 * @returns {string} 当前日期和时间的字符串表示。
 */
function currentDateFunc() {
  // 创建一个新的Date对象，用于获取当前时间
  const now = new Date();
  // 获取当前年份
  const year = now.getFullYear();
  // 获取当前月份，由于`getMonth`方法返回的值从0开始，因此需要加1
  const month = String(now.getMonth() + 1).padStart(2, "0");
  // 获取当前日期
  const day = String(now.getDate()).padStart(2, "0");
  // 获取当前小时
  const hours = String(now.getHours()).padStart(2, "0");
  // 获取当前分钟
  const minutes = String(now.getMinutes()).padStart(2, "0");
  // 获取当前秒数
  const seconds = String(now.getSeconds()).padStart(2, "0");

  // 返回格式化后的日期和时间字符串
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
