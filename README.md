[![Release](https://img.shields.io/github/v/release/wellm3id08/moodle-status-extension)](https://github.com/wellm3id08/moodle-status-extension/releases/latest)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Moodle](https://img.shields.io/badge/Moodle-F98012?logo=moodle&logoColor=white)
![Brave](https://img.shields.io/badge/Brave-FB542B?logo=brave&logoColor=white)
![Edge](https://img.shields.io/badge/Edge-0078D7)
![Chrome](https://img.shields.io/badge/Chrome-4285F4?logo=googlechrome&logoColor=white)

# Moodle Calendar Status

See which assignments you still need to submit in the Junta de Andalucía Moodle calendar. The extension adds Spanish status labels to assignments and quizzes. Click **✓** in the bottom left to see a summary and upcoming deadlines. Inside the panel, click **↻** to check again.

<p align="center">
<img src="img/Eg1.png" alt="Example 1" width="299%">
</p>

## Install

1. Download and unzip the repository, or clone it.
2. Open the extensions page in Chrome, Edge or Brave. Enable **Developer mode** and disable any older copy of the extension.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Sign in to Moodle and reload your calendar.

## How it works

The extension checks assignments by course. When a course overview lacks enough detail, it reads the activity page using your existing Moodle session. It reuses confirmed statuses for up to two minutes in the same tab. Requests stay on your Moodle campus, and the cache stores neither passwords nor grades.

<p align="center">
<img src="img/Eg2.png" alt="Example 1" width="299%">
</p>
