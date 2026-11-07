import test from 'node:test';
import assert from 'node:assert/strict';
import {validResourceAddress,resourceOpenUrl} from '../lib/resource-address.ts';
import {parseResourceInput} from '../lib/resource-input.ts';
import {parseDatabaseConnection,databaseAddress} from '../lib/database-connection.ts';
test('server addresses accept IPv4, IPv6 and existing web URLs without requiring a scheme',()=>{
 for(const url of ['192.0.2.10','2001:db8::10','[2001:db8::10]:8080','192.0.2.10:8080','https://host.example.test']) assert(validResourceAddress(url,'server'),url);
 for(const url of ['999.1.2.3','192.168.1','2001:::10','192.0.2.1/path','javascript:alert(1)','http://owner:secret@host/']) assert.equal(validResourceAddress(url,'server'),false,url);
 assert.equal(resourceOpenUrl({kind:'server',url:'192.0.2.10'}),'http://192.0.2.10');
 assert.equal(resourceOpenUrl({kind:'server',url:'2001:db8::10'}),'http://[2001:db8::10]');
 assert.equal(validResourceAddress('192.0.2.10','site'),false);
 assert.equal(resourceOpenUrl({kind:'database',url:'mysql://192.0.2.10:3306/appdb'}),undefined);
});
test('database metadata has explicit service, host, port, user and default database with no secret in address',()=>{
 const c=parseDatabaseConnection({service:'mysql',host:'192.0.2.10',port:3306,username:'app',database:'appdb',purpose:'test'})!;
 assert.equal(databaseAddress(c),'mysql://192.0.2.10:3306/appdb');
 assert(!databaseAddress(c).includes('app@'));
 const parsed=parseResourceInput({kind:'database',name:'QA Database',database:c,databasePassword:'fixture-only-password'});
 assert.equal(parsed.resource.url,databaseAddress(c));
 assert.equal(parsed.credential.databasePassword,'fixture-only-password');
 assert(!JSON.stringify(parsed.resource).includes('fixture-only-password'));
 for(const v of [{...c,port:0},{...c,port:65536},{...c,host:'http://host/'},{...c,service:'shell'},{...c,host:'host@other'}]) assert.throws(()=>parseDatabaseConnection(v));
 assert.throws(()=>parseResourceInput({kind:'site',name:'Site',url:'https://site.test',databasePassword:'fixture-only'}));
});
