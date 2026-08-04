# 概要
基于[AMLL Player Web](https://github.com/amll-dev/amll-page)和[Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics)修改的一个简易播放器

## 通过 URL 参数可以直接加载歌曲和歌词：
| 参数 | 类型 | 说明 |
|------|------|------|
| `lyric` | URL | 歌词文件直链，支持 `LRC`、`TTML` |
| `audio` | URL | 音频文件直链 |
| `img` | URL | 专辑封面图片直链 |
| `name` | 字符串 | 歌曲名称 |
| `artist` | 字符串 | 艺人名称 |
| `n` | 数字 | 网易云音乐歌曲 ID（自动获取歌曲信息） |

所有参数均可覆盖网易云音乐的 `n` 参数。如请求同时提供了 `n` 参数和 `lyric`、`img` 参数，则加载网易云音乐的音频，但使用自定义的歌词和封面图片。

## 交互
1. **点击歌词行** - 跳转到对应行时间点播放
2. **点击封面** - 播放/暂停
3. **悬停顶部区域** - 显示歌词偏移调整控件（竖屏不支持）
4. **空格键** - 播放/暂停

## 事项
1. 由于浏览器安全策略，本地文件需要通过 HTTP 服务器访问
2. 跨域资源需要配置 CORS 头
3. 网易云音乐歌曲仅支持公开可播放的曲目

## 许可
[LICENSE](LICENSE)
