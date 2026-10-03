/**
 * Ana pencere preload — şimdilik tek amacı: panoya native yazma köprüsü.
 *
 * Web'in kendi `navigator.clipboard.writeText()`'i Electron'da pencere
 * odakta değilken (ör. tam bu anda başka bir uygulamaya tıklanmışsa)
 * `NotAllowedError` ile sessizce başarısız olabiliyor — kullanıcı raporu:
 * davet linki modalında "Kopyala" bazen hiçbir şey yapmıyordu. Electron'un
 * kendi `clipboard` modülü (ana süreçte) bu kısıtlamaya tabi değil, o
 * yüzden IPC üzerinden oraya yönlendiriyoruz.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tuscordDesktop', {
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
});
