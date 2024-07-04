# node-down-m3u8 
nodejs下载m3u8文件并合并为mp4

## 环境要求
```
>=Node.js v10.12.0

使用了v10.12.0以上的版本 fs.mkdirSync(dirPath, { recursive: true });  

安装 ffmpeg，环境变量配置好ffmpeg路径
```


## 引入使用
```
使用实例
    npm install @shudazhang/node-down-m3u8
    const downloadFile = require('@shudazhang/node-down-m3u8')

    或者
    const downloadFile = require('./node-down-m3u8.js');

    downloadFile({
        href: "http://***.***.***.***/index.m3u8",
        fileName: "test.mp4",
    }).then(() => {
        console.log("下载完成");
    })
    .catch((error) => {
        console.log("下载失败");
    });

参数说明
    href: 下载文件的URL。
    headers: HTTP请求头。如:{Cookie: 'xxx', 'User-Agent': 'xxx'}
    timeout: 请求超时时间。默认:15000(毫秒)
    poolCount: 并发下载线程数。默认:5
    retry: 每个分片的重试次数。默认:10
    fileName: 下载文件的名称。默认:下载文件的URL的文件名。
    fileDir: 下载文件保存的目录。默认:当前目录
    cacheDir: 缓存文件保存的目录。默认:当前目录/URL的文件名。
    cacheDbName: 缓存数据库的名称。默认:00.json
    isCache: 是否使用缓存。默认:true, 可选[true,false]
    oldM3u8FileName: 内容与线上内容一致
    newM3u8FileName: 内容改为网络连接
    localM3u8FileName: 内容改为本地连接
    isWriteLog: 是否记录日志。默认:true, 可选[true,false]
    logDir: 日志文件保存的目录。默认:当前目录/log
    logFileName: 日志文件的名称。默认:log.txt
    isConsole: 是否在控制台输出日志。默认:true, 可选[true,false]
    onProgress: 下载进度回调函数。返回:[{index: 序号,href:下载地址,status: 状态(init:初始化,starting:开始下载,finish:下载完成)}]

```

## 命令行参数
```
使用实例
    node ./node-down-m3u8.js --href=http://***.***.***.***/index.m3u8 --fileName=test.mp4,

参数说明
    --href: 下载文件的URL。
    --headers: HTTP请求头。如:{Cookie: 'xxx', 'User-Agent': 'xxx'}
    --timeout: 请求超时时间。默认:15000(毫秒)
    --poolCount: 并发下载线程数。默认:5
    --retry: 每个分片的重试次数。默认:10
    --fileName: 下载文件的名称。默认:下载文件的URL的文件名。
    --fileDir: 下载文件保存的目录。默认:当前目录
    --cacheDir: 缓存文件保存的目录。默认:当前目录/URL的文件名。
    --cacheDbName: 缓存数据库的名称。默认:00.json
    --isCache: 是否使用缓存。默认:true, 可选[true,false]
    --oldM3u8FileName: 内容与线上内容一致
    --newM3u8FileName: 内容改为网络连接
    --localM3u8FileName: 内容改为本地连接
    --isWriteLog: 是否记录日志。默认:true, 可选[true,false]
    --logDir: 日志文件保存的目录。默认:当前目录/log
    --logFileName: 日志文件的名称。默认:log.txt
    --isConsole: 是否在控制台输出日志。默认:true, 可选[true,false]
    --onProgress: 下载进度回调函数。返回:[{index: 序号,href:下载地址,status: 状态(init:初始化,starting:开始下载,finish:下载完成)}]
```
## 功能介绍
```
[√] 自定义headers
[√] 超时时间
[√] 线程数
[√] 下载路径
[√] 下载文件名
[√] 缓存目录
[√] 缓存数据文件名
[√] 是否使用缓存
[√] 是否记录日志
[√] 日志文件保存的目录
[√] 日志文件的名称
[√] 是否在控制台输出日志
[√] 错误处理回调函数
[√] 下载成功回调函数
[√] 下载进度回调函数
[√] 输出MP4文件
```

## 版本更新
> v0.0.1
```
首次提交
```
