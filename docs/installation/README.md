---
title: Installation
children:
  - installer.md
  - raspberry_pi_installation.md
  - npm.md
  - docker.md
  - source.md
  - updating.md
  - command_line.md
---

# Installation

Signal K Server is a [NodeJS](https://nodejs.org/en) application which can run on nearly any computer and operating system, including Windows, Linux, and macOS.

Currently the most cost effective, powerful and best supported hardware platform for a Signal K server is the [Raspberry
Pi](https://www.raspberrypi.com). Any Raspberry Pi (even the very first model) can be used but for best performance we recommend Raspberry Pi 4 model B or 5. If you don't have a Raspberry Pi, any old laptop or computer you have sitting around would make a good initial test platform, although for permanent use on a yacht, more power efficient hardware like a Raspberry Pi is strongly recommended.

## Recommended: GUI Installer

The easiest way to install Signal K Server is using the **[SignalK Installer](installer.md)** - a cross-platform GUI application that bundles everything you need. No prerequisites required!

[Download the latest installer](https://github.com/SignalK/signalk-server/releases) for Windows, macOS, or Linux.

## Other Installation Methods

For advanced users, developers, or specific use cases:

| Method                                       | Best For                 | Prerequisites   |
| -------------------------------------------- | ------------------------ | --------------- |
| [GUI Installer](installer.md)                | End users, easiest setup | None            |
| [Raspberry Pi](raspberry_pi_installation.md) | Dedicated Pi setup       | Raspberry Pi OS |
| [NPM](npm.md)                                | Developers               | Node.js 20+     |
| [Docker](docker.md)                          | Container environments   | Docker          |
| [Source](source.md)                          | Contributors             | Node.js, Git    |

## Getting Started

- [SignalK Installer](installer.md) - **Recommended for most users**
- [Installing on Raspberry Pi](raspberry_pi_installation.md)
- [Installing on Windows](https://github.com/SignalK/signalk-server-windows)
- [Installing from NPM](npm.md)
- [Installing from Docker](docker.md)
- [Installing from Source](source.md)
