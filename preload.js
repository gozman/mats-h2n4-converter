const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.send('select-file'),
  updateProgress: (callback) => ipcRenderer.on('update-progress', (event, progress) => callback(progress)),
  conversionDone: (callback) => ipcRenderer.on('conversion-done', (event, outputPath, handCount) => callback(outputPath, handCount))
});

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
      const element = document.getElementById(selector)
      if (element) element.innerText = text
    }
  
    for (const dependency of ['chrome', 'node', 'electron']) {
      replaceText(`${dependency}-version`, process.versions[dependency])
    }
  })
