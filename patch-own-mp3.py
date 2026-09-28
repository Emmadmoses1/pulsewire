p='admin.html'
s=open(p,encoding='utf-8').read()
if '/* OWN MP3 UPLOAD */' in s:
    print('already patched'); raise SystemExit
open('admin.html.bak-ownmp3','w',encoding='utf-8').write(s)

anchor='<input type="text" id="songDownloadUrl" placeholder="https://... (optional)"></div>'
block=anchor+'''
      <div class="field" id="ownMp3Box" style="border:1px dashed var(--border);border-radius:10px;padding:12px">
        <label>Upload your MP3 (tag + host)</label>
        <input type="file" id="ownMp3File" accept="audio/mpeg,.mp3">
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:12px;text-transform:none;letter-spacing:0">
          <input type="checkbox" id="ownMp3Rights" style="width:auto;margin-top:2px">
          <span>I own this audio or have permission to distribute it.</span>
        </label>
        <button type="button" class="btn btn-sm btn-dark" id="ownMp3Btn" onclick="uploadOwnMp3()" style="width:auto;padding:8px 14px;margin-top:8px">🎵 Tag &amp; Upload MP3</button>
        <div id="ownMp3Status" style="font-size:11px;color:#888;margin-top:8px"></div>
        <div class="prog-wrap" id="ownMp3Prog"><div class="prog-fill" id="ownMp3Bar"></div></div>
      </div>'''
n2=s.count(anchor)
if n2==1: s=s.replace(anchor,block)

JS=r'''<script>
/* OWN MP3 UPLOAD */
async function uploadOwnMp3(){
  const status=document.getElementById('ownMp3Status');
  const bar=document.getElementById('ownMp3Bar');
  const btn=document.getElementById('ownMp3Btn');
  const say=(t,c)=>{status.style.color=c||'#888';status.textContent=t;};
  const file=document.getElementById('ownMp3File').files[0];
  if(!document.getElementById('ownMp3Rights').checked){alert('Please confirm you own this audio or have permission to distribute it.');return;}
  if(!file){alert('Choose an MP3 file first.');return;}
  if(!/\.mp3$/i.test(file.name)&&file.type!=='audio/mpeg'){alert('Only MP3 files are supported.');return;}
  if(file.size>100*1024*1024){alert('File is too large (max 100 MB).');return;}
  const title=document.getElementById('songTitle').value.trim();
  const artistSel=document.getElementById('songArtist');
  const artist=(artistSel.options[artistSel.selectedIndex]?.text||'').trim();
  if(!title){alert('Enter the song title first.');return;}
  btn.disabled=true;btn.textContent='⏳ Working...';
  let stage='reading file';
  try{
    say('Reading file...');bar.style.width='5%';document.getElementById('ownMp3Prog').style.display='block';
    let buf=await file.arrayBuffer();
    const b=new Uint8Array(buf);
    if(b.length>10&&b[0]===0x49&&b[1]===0x44&&b[2]===0x33){
      const size=((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f);
      buf=buf.slice(10+size);
    }
    stage='loading tagger';say('Tagging MP3...');bar.style.width='20%';
    const {ID3Writer}=await import('https://cdn.jsdelivr.net/npm/browser-id3-writer@6.3.1/dist/browser-id3-writer.mjs');
    stage='fetching cover';
    let coverBuf=null;
    try{const cr=await fetch(FLYER_COVER_URL);if(cr.ok)coverBuf=await cr.arrayBuffer();}catch(e){}
    stage='tagging';
    const id3=new ID3Writer(buf);
    id3.setFrame('TIT2',title).setFrame('TPE1',[artist||'WAVZO']).setFrame('TALB','wavzo.com.ng');
    if(coverBuf)id3.setFrame('APIC',{type:3,data:coverBuf,description:'Cover'});
    id3.addTag();
    const blob=id3.getBlob();
    stage='uploading to Cloudinary';say('Uploading to WAVZO...');bar.style.width='40%';
    const safe=title.replace(/[^a-z0-9]/gi,'-').toLowerCase()+'-'+Date.now();
    const tagged=new File([blob],safe+'.mp3',{type:'audio/mpeg'});
    const pubId=await uploadCloudPublicId(tagged,'ownMp3Prog','ownMp3Bar');
    const url='https://res.cloudinary.com/'+CLOUD+'/video/upload/l_video:'+VOICE_TAG_ID+',fl_splice,e_volume:200/fl_layer_apply,so_0,du_3/'+pubId+'.mp3';
    document.getElementById('songDownloadUrl').value=url;
    bar.style.width='100%';
    say('✓ MP3 ready - download link filled in.','#22c55e');
    btn.textContent='✓ Done';
  }catch(e){
    const msg=(e&&e.error&&e.error.message)||(e&&e.message)||JSON.stringify(e);
    say('Failed at '+stage+': '+msg,'#ef4444');
    btn.textContent='🎵 Tag & Upload MP3';
    alert('Upload failed at '+stage+': '+msg);
  }
  btn.disabled=false;
  if(btn.textContent==='✓ Done')setTimeout(()=>{btn.textContent='🎵 Tag & Upload MP3';},3000);
}
</script>'''
i=s.rfind('</body>')
s=(s+JS) if i==-1 else (s[:i]+JS+'\n'+s[i:])
open(p,'w',encoding='utf-8').write(s)
print('YouTube button untouched | form block added:',n2)
