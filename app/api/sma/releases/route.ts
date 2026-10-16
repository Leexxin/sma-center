import { getOwner } from '@/app/auth';
import { releaseService } from '@/lib/release-sync.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!await getOwner()) return Response.json({ error: '请先登录。' }, { status: 401 });
  try { return Response.json(releaseService().status(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: '无法读取版本中心状态，请检查数据文件和密钥。' }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!await getOwner()) return Response.json({ error: '请先登录。' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 8192) return Response.json({ error: '请求过大。' }, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 8192) return Response.json({ error: '请求过大。' }, { status: 413 });
    const body = JSON.parse(text), service = releaseService();
    if (body.action === 'configure') { service.configure(body.shareUrl); return Response.json(service.status()); }
    if (body.action === 'refresh') return Response.json(await service.releases());
    if (body.action === 'commands') return Response.json(await service.commands(body.tag, body.platform));
    if (['compare', 'sync'].includes(body.action)) return Response.json(service.start(body.action, body.tag, body.allowOverwrite === true), { status: 202 });
    return Response.json({ error: '不支持的操作。' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && !/https?:\/\//.test(error.message) ? error.message : '操作失败，请检查配置与服务网络。';
    return Response.json({ error: message }, { status: 400 });
  }
}
