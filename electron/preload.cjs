const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pickingAPI',Object.freeze({
  state:()=>ipcRenderer.invoke('picking:state'),
  configure:c=>ipcRenderer.invoke('picking:configure',c),
  action:a=>ipcRenderer.invoke('picking:action',a),
  import:kind=>ipcRenderer.invoke('picking:import',kind),
  export:()=>ipcRenderer.invoke('picking:export'),
  printLabels:boxes=>ipcRenderer.invoke('picking:print',boxes)
}));
