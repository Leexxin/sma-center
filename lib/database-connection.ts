export const databaseServices = { mysql: {label:"MySQL",port:3306}, postgresql: {label:"PostgreSQL",port:5432}, redis: {label:"Redis",port:6379}, elasticsearch: {label:"Elasticsearch",port:9200} } as const;
export type DatabaseConnection = {service:keyof typeof databaseServices; host:string; port:number; username:string; database:string; purpose:string};
export function parseDatabaseConnection(value: unknown): DatabaseConnection | undefined {
  if (value == null) return undefined;
  const v=value as Record<string,unknown>;
  const service=String(v.service) as DatabaseConnection["service"], host=String(v.host??"").trim(), port=Number(v.port);
  if (!Object.hasOwn(databaseServices,service) || !host || host.length>253 || /[\s/@?#\\]/.test(host) || !Number.isInteger(port) || port<1 || port>65535) throw new Error("INVALID_DATABASE_CONNECTION");
  try { const u=new URL(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`); if(u.port || u.pathname!=="/")throw new Error(); } catch {throw new Error("INVALID_DATABASE_CONNECTION");}
  const username=String(v.username??"").trim(), database=String(v.database??"").trim(), purpose=String(v.purpose??"").trim();
  if(username.length>128 || database.length>128 || purpose.length>240 || /[\r\n]/.test(username+database))throw new Error("INVALID_DATABASE_CONNECTION");
  return {service,host,port,username,database,purpose};
}
export function databaseAddress(c:DatabaseConnection) {
  const host=c.host.includes(":")&&!c.host.startsWith("[")?`[${c.host}]`:c.host;
  return `${c.service === "elasticsearch" ? "http" : c.service}://${host}:${c.port}/${encodeURIComponent(c.database)}`;
}
