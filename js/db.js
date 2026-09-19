const BIN_ID='6aa50e3aac6210605ac3c542';
const BIN_KEY='public';
const BIN_URL='https://wavzo-db.dakudinamoses.workers.dev/v3/b/'+BIN_ID;

async function loadPosts(){
  const res=await fetch(BIN_URL+'/latest',{
    headers:{'X-Master-Key':BIN_KEY}
  });
  const data=await res.json();
  return (data.record||{posts:[]}).posts||[];
}
