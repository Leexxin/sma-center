import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {encryptCredential,decryptCredential} from '../lib/credential-crypto.ts';
test('database import encrypts credentials, preserves unrelated data, is idempotent and rejects duplicate input',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'sma-db-import-'));
 const env={...process.env,SMA_CENTER_DATA_DIR:directory};
 const secret=Buffer.alloc(32,9).toString('base64');
 writeFileSync(join(directory,'secrets.json'),JSON.stringify({credential:secret}),{mode:0o600});
 const setup=spawnSync(process.execPath,['--input-type=module','-e',"const {env:{DB}}=await import('./deploy/sqlite-env.mjs');await DB.prepare('INSERT INTO users VALUES (?,?,?,?,?)').bind('selfhost:admin','fixture@example.test','Fixture',1,1).run();"],{env,encoding:'utf8'});
 assert.equal(setup.status,0,setup.stderr);
 const row={name:'Fixture MySQL',connection:{service:'mysql',host:'192.0.2.80',port:3306,username:'app',database:'appdb',purpose:'fixture'},password:'fixture-password-only'};
 const run=input=>spawnSync(process.execPath,['--experimental-strip-types','scripts/import-database-resources.mjs'],{env,input:JSON.stringify(input),encoding:'utf8'});
 try{
  let r=run([row]);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{created:1,updated:0,unchanged:0,processed:1});
  assert(!r.stdout.includes(row.password));assert(!r.stderr.includes(row.password));
  const db=new DatabaseSync(join(directory,'sma-center.sqlite'));
  const resource=db.prepare('SELECT * FROM resources').get();
  assert(!JSON.stringify(resource).includes(row.password));
  const credential=db.prepare('SELECT * FROM database_credentials').get();
  assert.equal(await decryptCredential({ciphertext:credential.ciphertext,iv:credential.iv,keyVersion:credential.key_version},secret,'selfhost:admin','database:'+resource.id),row.password);
  await assert.rejects(()=>decryptCredential({ciphertext:credential.ciphertext,iv:credential.iv,keyVersion:credential.key_version},secret,'selfhost:admin',resource.id));
  const snapshot=JSON.stringify(credential);
  r=run([row]);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).unchanged,1);assert.equal(JSON.stringify(db.prepare('SELECT * FROM database_credentials').get()),snapshot);
  r=run([row,row]);assert.equal(r.status,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resources').get().n,1);
  r=run([{...row,password:''}]);assert.equal(r.status,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resources').get().n,1);
  const corrupt=await encryptCredential('fixture',secret,'different-owner','different-id');
  db.prepare('UPDATE database_credentials SET ciphertext=?,iv=?').run(corrupt.ciphertext,corrupt.iv);
  r=run([{...row,name:'Should not overwrite'}]);assert.equal(r.status,1);assert.equal(db.prepare('SELECT name FROM resources').get().name,row.name);
  db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
