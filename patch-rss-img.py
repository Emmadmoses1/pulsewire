p='admin.html'
s=open(p,encoding='utf-8').read()
if '/* RSS image fix */' in s:
    print('already patched'); raise SystemExit
open('admin.html.bak-rssimg','w',encoding='utf-8').write(s)
JS = r'''<script>
/* RSS image fix */
function toHttps(u){return u?String(u).replace(/^http:\/\//i,'https://'):u;}
function upscaleImage(url){
  if(!url)return url;
  url=toHttps(url);
  if(/[?&]s=/.test(url))return url;
  url=url.replace(/\/standard\/\d+\//,'/standard/976/');
  url=url.replace(/([?&])width=(\d+)/,(m,p1)=>p1+'width=1200');
  return url;
}
async function rehostImage(urls){
  let lastErr='';
  for(const u of urls){
    if(!u)continue;
    try{
      const fd=new FormData();
      fd.append('file',u);
      fd.append('upload_preset',PRESET);
      const r=await fetch('https://api.cloudinary.com/v1_1/'+CLOUD+'/image/upload',{method:'POST',body:fd});
      const d=await r.json();
      if(d.secure_url)return d.secure_url;
      lastErr=(d.error&&d.error.message)||'upload failed';
    }catch(e){lastErr=e.message;}
  }
  throw new Error(lastErr||'no image');
}
async function findOgImage(link){
  const r=await fetch('https://corsproxy.io/?'+encodeURIComponent(link));
  const html=await r.text();
  const m=html.match(/property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i)||html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m?m[1].replace(/&amp;/g,'&'):null;
}
async function useNews(i){
  const item=window._newsItems[i];
  document.getElementById('pTitle').value=item.title;
  document.getElementById('pExcerpt').value=item.excerpt;
  document.getElementById('pContent').value=(item.fullContent||item.excerpt)+'\n\nSource: '+item.link;
  const prev=document.getElementById('coverPrev');
  const fname=document.getElementById('coverFname');
  _rssImageUrl=null;
  prev.style.display='none';
  fname.textContent='Fetching image...';
  const show=url=>{
    _rssImageUrl=url;
    prev.setAttribute('referrerpolicy','no-referrer');
    prev.src=url;prev.style.display='block';
    fname.textContent='Image from '+item.source;
    document.getElementById('scanCoverBtn').style.display='inline-block';
  };
  let hosted=null;
  if(item.image){
    try{hosted=await rehostImage([upscaleImage(item.image),toHttps(item.image)]);}catch(e){console.warn('feed image failed:',e.message);}
  }
  if(!hosted){
    try{
      const og=await findOgImage(item.link);
      if(og){try{hosted=await rehostImage([og]);}catch(e){hosted=og;}}
    }catch(e){console.warn('og:image failed:',e.message);}
  }
  if(hosted)show(hosted);
  else if(item.image)show(toHttps(item.image));
  else fname.textContent='No image found - upload manually';
}
</script>'''
n=0
a='<img src="${item.image}" style="width:60px'
if a in s:
    s=s.replace(a,'<img src="${item.image}" referrerpolicy="no-referrer" style="width:60px'); n+=1
b='<img id="coverPrev" style="display:none">'
if b in s:
    s=s.replace(b,'<img id="coverPrev" referrerpolicy="no-referrer" style="display:none">'); n+=1
i=s.rfind('</body>')
if i==-1: s+=JS
else: s=s[:i]+JS+'\n'+s[i:]
open(p,'w',encoding='utf-8').write(s)
print('patched OK, small edits applied:',n)
