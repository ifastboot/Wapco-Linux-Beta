'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const app = require('electron').remote.app
window.remote = remote
window.$ = window.jQuery = require('jquery')
const execSync = require('child_process').execSync
const spawn = require('child_process').spawn

/*
  Convert unicode bytes to string.
*/
let _utf8ArrayToStr = function (array) {
  let out, i, len, c, char2, char3
  out = ''
  len = array.length
  i = 0
  while (i < len) {
    c = array[i++]
    switch (c >> 4) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
        // 0xxxxxxx
        out += String.fromCharCode(c)
        break
      case 12: case 13:
        // 110x xxxx   10xx xxxx
        char2 = array[i++]
        out += String.fromCharCode(
          ((c & 0x1F) << 6) |
          (char2 & 0x3F)
        )
        break
      case 14:
        // 1110 xxxx  10xx xxxx  10xx xxxx
        char2 = array[i++]
        char3 = array[i++]
        out += String.fromCharCode(
          ((c & 0x0F) << 12) |
          ((char2 & 0x3F) << 6) |
          ((char3 & 0x3F) << 0)
        )
        break
    }
  }
  return out
}

/*
  Python modules can not be run from inside an Electron Asar. On Win32 we
  therefor unpack them to app.getPath('userData'). On Darwin and Linux __dirname
  does not point inside an Asar and so this step isn't needed.
*/
module.exports.getPythonAppDir = function () {
  if (os.platform() === 'win32') {
    return path.join(app.getPath('userData'), 'python')
  } else {
    return path.join(__dirname, 'python')
  }
}
module.exports.getHtmlAppDir = function () {
  if (os.platform() === 'win32') {
    return path.join(app.getPath('userData'), 'html')
  } else {
    return path.join(__dirname, 'html')
  }
}
/*
  Unpack Python modules to to app.getPath('userData') on Win32.
*/
module.exports.initPythonWin32 = function (callback) {
  if (os.platform() === 'win32') {
    let pythonFileSystemDir = path.join(app.getPath('userData'), 'python')
    try {
      // This will throw if it fails. If it works there is nothing to do.
      fs.accessSync(pythonFileSystemDir, fs.constants.F_OK)
      if (typeof callback === 'function') {
        callback()
      }
    } catch (error) {
      console.log(error.message, 'Creating pythonFileSystemDir', pythonFileSystemDir)
      let pythonAsarDir = path.join(__dirname, 'python')
      fs.mkdirSync(pythonFileSystemDir, '0644')
      fs.readdir(pythonAsarDir, (error, files) => {
        if (error) {
          console.log(error)
          return false
        }
        let type = ''
        let source = ''
        let target = ''
        for (let file of files) {
          type = path.basename(file).split('.')[1]
          if (type === 'py') {
            source = path.join(pythonAsarDir, file)
            target = path.join(pythonFileSystemDir, path.basename(file))
            fs.createReadStream(source).pipe(fs.createWriteStream(target))
          }
        }
      })
      if (typeof callback === 'function') {
        callback()
      }
    }
  }
}

/*
  Attempt to locate Python 3+ across platforms.
*/
module.exports.getPythonPath = function () {
  let platform = os.platform()
  let which = null
  let pythonPath = ''
  let pythonBin = ''
  let python = ''
  let version = null
  let v = null
  let options = null
  let delimiter = ':'
  if (platform === 'darwin') {
    options = {
      env: { PATH: '/usr/local/bin' + path.delimiter + process.env.PATH }
    }
    which = 'which python3'
    try {
      python = _utf8ArrayToStr(execSync(which, options)).replace(/\r?\n|\r/g, '')
      version = python + ' -V'
      v = parseInt(_utf8ArrayToStr(
        execSync(version, options)).split(' ')[1].split('.')[0])
      if (v === 3) {
        pythonPath = python
        pythonBin = pythonPath.replace(/\r?\n|\r/g, '')
      }
    } catch (e) {
      return null
    }
  } else if (platform === 'linux') {
    options = {
      env: { PATH: '/usr/bin' + path.delimiter + process.env.PATH }
    }
    which = 'which python3'
    try {
      python = _utf8ArrayToStr(execSync(which, options)).replace(/\r?\n|\r/g, '')
      version = python + ' -V'
      v = parseInt(_utf8ArrayToStr(
        execSync(version, options)).split(' ')[1].split('.')[0])
      if (v === 3) {
        pythonPath = python
        pythonBin = pythonPath.replace(/\r?\n|\r/g, '')
      }
    } catch (e) {
      return null
    }
  } else if (platform === 'win32') {
    delimiter = ';'
    which = 'where python3'
    try {
      python = _utf8ArrayToStr(execSync(which, {})).replace(/\r?\n|\r/g, '')
      if (python.length > 0) {
        pythonPath = python
        pythonBin = pythonPath.replace(/\r?\n|\r/g, '')
      }
    } catch (e) {
      try {
        which = 'where python'
        python = _utf8ArrayToStr(execSync(which, {})).replace(/\r?\n|\r/g, '')
        if (python.length > 0) {
          try {
            version = '"' + python + '" -V 2>&1'
            v = parseInt(_utf8ArrayToStr(
              execSync(version, {})).split(' ')[1].split('.')[0])
            if (v === 3) {
              pythonPath = python
              pythonBin = pythonPath.replace(/\r?\n|\r/g, '')
            }
          } catch (e) {
            return null
          }
        }
      } catch (e) {
        return null
      }
    }
  }
  if (pythonPath.length > 0) {
    return {
      pythonPath: path.dirname(pythonPath.replace(/\r?\n|\r/g, '')),
      pythonBin: pythonBin,
      delimiter: delimiter
    }
  }
}

/*
  Check to see if required Python modules are installed. Ask the user to
  install what's missing. See app/python/check_depends.py
*/
module.exports.getPythonDepends = function () {
  let pyPath = this.getPythonPath()
  let pyDir = this.getPythonAppDir()
  let script = path.join(pyDir, 'check_depends.py')
  let cd = spawn(pyPath.pythonBin, [script], {
    cwd: pyDir,
    env: {
      PATH: pyPath.pythonPath + pyPath.delimiter + process.env.PATH,
      PYTHONIOENCODING: 'utf-8'
    }
  })
  cd.stderr.on('data', (data) => {
    let options = {
      title: 'Python Modules?',
      type: 'info',
      message: _utf8ArrayToStr(data),
      buttons: []
    }
    try {
      remote.dialog.showMessageBox(window.remote.getCurrentWindow(), options)
    }
    catch(err) {
      document.write(err.message)
    }
  })
  cd.on('close', (code) => {
    console.log('controller.getPythonDepends child ' +
      `process exited with code ${code}`)
  })
}
