# StreamGrab YouTube Downloader - Browser Extension 🚀

Download YouTube videos and music as **MP3 (320k, 256k, 192k, 128k)** or **MP4 (1080p, 720p, 480p, 360p)** with one click directly attached inside YouTube!

---

## ✨ Features
- **Native YouTube Integration**: Adds an elegant StreamGrab button directly next to YouTube's Like/Share/Subscribe buttons.
- **MP3 Audio & Video Quality Selector**: Choose from 320k, 256k, 192k, 128k MP3 or 1080p, 720p, 480p, 360p MP4.
- **🎵 MP3 Only Mode**: Turn on "MP3 Only Mode" in settings to turn the YouTube button into an instant 1-click MP3 downloader that hides video options completely!
- **⚡ 1-Click Fast MP3 (320k)**: Download extreme quality audio with a single tap.
- **Real-Time Progress In-Page**: Watch live download percentage, download speed (e.g. 14.5 MB/s), ETA, and audio conversion steps.
- **Automatic Browser Downloads**: Files are automatically named with clean video titles and saved directly to your computer's `Downloads` folder.
- **Local & Cloud Backend Support**: Seamlessly connects to your fast local server (`http://127.0.0.1:5000`) or your hosted cloud server (`https://youtube-downloader-xs7u.onrender.com`).

---

## 🛠️ How to Install in Google Chrome / Brave / Edge (3 Steps)

1. **Open Extensions Page**:
   - In **Google Chrome** or **Brave**: Navigate to `chrome://extensions/`
   - In **Microsoft Edge**: Navigate to `edge://extensions/`
2. **Enable Developer Mode**:
   - Toggle the **"Developer mode"** switch in the top right corner.
3. **Load Unpacked Extension**:
   - Click the **"Load unpacked"** button in the top left.
   - Select this folder:
     ```
     F:\community project\youtube_downloader\extension
     ```
4. **Done!**
   - You will see the **StreamGrab - YouTube Downloader** extension active in your browser toolbar!

---

## 🎧 How to Use

1. Make sure your StreamGrab server is running:
   ```bash
   python server.py
   ```
2. Open any video on [YouTube](https://www.youtube.com):
   - You will see the orange **StreamGrab (MP3 / Video)** pill button right in the YouTube action row!
3. Click the button to choose **MP3** (320k, 256k, 192k) or **MP4** (1080p, 720p) and tap **Download**!
4. The file will convert and download directly to your PC!

---

## ⚙️ Configuration & "MP3 Only Mode"

Click the **StreamGrab extension icon** in your browser toolbar to open the settings popup:
- **Server Endpoint**: Choose `Localhost (http://127.0.0.1:5000)` (super fast, no datacenter blocks) or `Render Cloud Server`.
- **🎵 MP3 Audio Only Mode**: Toggle this ON if you only want to download music/MP3. The YouTube button will instantly become a pure `Download MP3` button!
- **Default Audio Bitrate**: Pick your preferred default (e.g. 320 kbps).
