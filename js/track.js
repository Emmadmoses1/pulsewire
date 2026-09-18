const BIN_ID='6aa50e3aac6210605ac3c542';
const BIN_KEY='$2a$10$mdqVObTCy3dJ/mscdn./0.AscxgxHKCM0Mq.O7ApHHlKB1UVXsFy6';
const BIN_URL='https://api.jsonbin.io/v3/b/'+BIN_ID;

async function trackView(slug){
  try{
    const res=await fetch(BIN_URL+'/latest',{headers:{'X-Master-Key':BIN_KEY}});
    const data=await res.json();
    const db=data.record||{posts:[]};
    const post=db.posts.find(p=>p.slug===slug);
    if(post){
      post.views=(post.views||0)+1;
      await fetch(BIN_URL,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':BIN_KEY},body:JSON.stringify(db)});
    }
  }catch(e){}
}

async function trackDownload(slug,type){
  try{
    const res=await fetch(BIN_URL+'/latest',{headers:{'X-Master-Key':BIN_KEY}});
    const data=await res.json();
    const db=data.record||{posts:[]};
    const post=db.posts.find(p=>p.slug===slug);
    if(post){
      post.downloads=(post.downloads||0)+1;
      if(type==='audio') post.audioDownloads=(post.audioDownloads||0)+1;
      if(type==='video') post.videoDownloads=(post.videoDownloads||0)+1;
      await fetch(BIN_URL,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':BIN_KEY},body:JSON.stringify(db)});
    }
  }catch(e){}
}
