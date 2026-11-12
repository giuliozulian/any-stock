import { appIcon } from '@/lib/app-icon'

const SIZES = [180, 192, 512]

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params
  const n = Number(size)
  if (!SIZES.includes(n)) return new Response('Not found', { status: 404 })
  return appIcon(n)
}
