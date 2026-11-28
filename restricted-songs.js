'use strict';

const RestrictedSongs = (() => {
  function folderIds(folders){
    const ids=new Set(folders.filter(folder=>folder.name==='失格曲').map(folder=>folder.id));
    for(const id of ids){
      for(const folder of folders)if(folder.parent===id)ids.add(folder.id);
    }
    return ids;
  }

  let visible=false;
  async function acceptCommand(value){
    if(value==='/失格曲を隠す'){visible=false;return '失格曲を非表示にしました';}
    if(value!=='/失格曲')return null;
    if(visible)return '失格曲を表示中です';
    const dialog=document.createElement('dialog');
    const form=document.createElement('form');
    form.method='dialog';
    const label=document.createElement('label');
    const input=document.createElement('input');
    input.type='password';
    input.required=true;
    label.append('失格曲のパスワード ',input);
    const submit=document.createElement('button');
    submit.textContent='表示';
    const cancel=document.createElement('button');
    cancel.type='button';cancel.textContent='キャンセル';
    cancel.onclick=()=>dialog.close();
    form.append(label,submit,cancel);dialog.append(form);document.body.append(dialog);
    const password=await new Promise(resolve=>{
      form.onsubmit=event=>{event.preventDefault();dialog.close('submit');};
      dialog.onclose=()=>resolve(dialog.returnValue==='submit'?input.value:null);
      dialog.showModal();
    });
    dialog.remove();
    if(password===null)return '';
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
    visible=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')==='9d27673073578724900d9ad7e8b900abaa6a9638960ab734d2df8165ccd15c7d';
    return visible?'失格曲を記録なしで表示します':'パスワードが違います';
  }
  return {folderIds,acceptCommand,get visible(){return visible;}};
})();
if(typeof module!=='undefined')module.exports=RestrictedSongs;
