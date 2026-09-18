const BIN_ID='6aa50e3aac6210605ac3c542';
const BIN_KEY='$2a$10$mdqVObTCy3dJ/mscdn./0.AscxgxHKCM0Mq.O7ApHHlKB1UVXsFy6';
const BIN_URL='https://api.jsonbin.io/v3/b/'+BIN_ID;

async function loadPosts(){
  const res=await fetch(BIN_URL+'/latest',{
    headers:{'X-Master-Key':BIN_KEY}
  });
  const data=await res.json();
  return (data.record||{posts:[]}).posts||[];
}
