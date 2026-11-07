// Operator-only import: JSON on stdin; never accept passwords as command arguments.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDatabaseConnection, databaseAddress } from '../lib/database-connection.ts';
import { encryptCredential, decryptCredential } from '../lib/credential-crypto.ts';
let db, transaction=false;
try {
  let length=0;const chunks=[];
  for await (const chunk of process.stdin) {length+=chunk.length;if(length>1_000_000)throw new Error('INPUT_TOO_LARGE');chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(input)||!input.length||input.length>100)throw new Error('INVALID_INPUT');
  const rows=input.map(item=>{
    const name=typeof item.name==='string'?item.name.trim():'';
    const connection=parseDatabaseConnection(item.connection);
    if(!name||name.length>80||!connection||typeof item.password!=='string'||!item.password||item.password.length>4096)throw new Error('INVALID_INPUT');
    return {name,connection,password:item.password};
  });
  const identity=c=>JSON.stringify([c.service,c.host,c.port,c.username,c.database]);
  if(new Set(rows.map(r=>identity(r.connection))).size!==rows.length)throw new Error('DUPLICATE_INPUT');
  const directory=process.env.SMA_CENTER_DATA_DIR||'/data';
  const secret=JSON.parse(readFileSync(join(directory,'secrets.json'),'utf8')).credential;
  const owner=process.env.SMA_CENTER_OWNER_ID||'selfhost:admin';
  await import('../deploy/sqlite-env.mjs');
  db=new DatabaseSync(join(directory,'sma-center.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');transaction=true;
  if(!db.prepare('SELECT user_id FROM users WHERE user_id=?').get(owner))throw new Error('OWNER_NOT_FOUND');
  const summary={created:0,updated:0,unchanged:0,processed:rows.length};
  for(const row of rows){
    const candidates=db.prepare("SELECT * FROM resources WHERE user_id=? AND kind='database'").all(owner).filter(r=>{
      const c=JSON.parse(r.database_config);return c.service && identity(c)===identity(row.connection);
    });
    if(candidates.length>1)throw new Error('AMBIGUOUS_EXISTING_RESOURCE');
    const existing=candidates[0],id=existing?.id||randomUUID(),now=Date.now();
    const encrypted=db.prepare('SELECT * FROM database_credentials WHERE resource_id=? AND user_id=?').get(id,owner);
    const samePassword=encrypted && await decryptCredential({ciphertext:encrypted.ciphertext,iv:encrypted.iv,keyVersion:encrypted.key_version},secret,owner,`database:${id}`)===row.password;
    const config=JSON.stringify(row.connection),url=databaseAddress(row.connection);
    const sameResource=existing && existing.name===row.name && existing.url===url && existing.database_config===config;
    if(!existing){
      db.prepare("INSERT INTO resources (id,user_id,kind,name,url,description,category,database_config,created_at,updated_at) VALUES (?,?,'database',?,?,?,'数据库',?,?,?)").run(id,owner,row.name,url,row.connection.purpose,config,now,now);
      summary.created++;
    }else if(!sameResource||!samePassword){
      db.prepare('UPDATE resources SET name=?,url=?,database_config=?,updated_at=? WHERE id=? AND user_id=?').run(row.name,url,config,now,id,owner);
      summary.updated++;
    }else summary.unchanged++;
    if(!samePassword){
      const value=await encryptCredential(row.password,secret,owner,`database:${id}`);
      db.prepare('INSERT INTO database_credentials (resource_id,user_id,ciphertext,iv,key_version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,key_version=excluded.key_version,updated_at=excluded.updated_at').run(id,owner,value.ciphertext,value.iv,value.keyVersion,now);
    }
  }
  db.exec('COMMIT');transaction=false;db.close();
  console.log(JSON.stringify(summary));
} catch {
  if(transaction)try{db.exec('ROLLBACK');}catch{}
  console.error('Database resource import failed; no partial resource changes were committed.');
  process.exitCode=1;
}
