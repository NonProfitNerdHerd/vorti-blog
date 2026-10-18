import { ValidationError, type GlobalBeforeValidateHook } from 'payload'

export const validateSiteSettings: GlobalBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const merged = { ...originalDoc, ...data }
  const id = (v: unknown) =>
    v && typeof v === 'object' && 'id' in v ? String(v.id) : v == null ? '' : String(v)
  const errors: Array<{ path: string; message: string }> = []
  if (id(merged.homepage) && id(merged.homepage) === id(merged.blogPage))
    errors.push({
      path: 'blogPage',
      message: 'Choose different pages for the homepage and posts page.',
    })
  for (const key of ['homepage', 'blogPage', 'privacyPolicyPage']) {
    if (!data || !(key in data) || !id(data[key])) continue
    const result = await req.payload.find({
      collection: 'pages',
      req,
      overrideAccess: false,
      draft: false,
      depth: 0,
      limit: 1,
      where: { and: [{ id: { equals: id(data[key]) } }, { _status: { equals: 'published' } }] },
    })
    const page = result.docs[0]
    if (!page || /^(admin|api|posts|forms|_next)$/.test(page.slug || ''))
      errors.push({
        path: key,
        message: 'Choose an available published page with a non-reserved URL.',
      })
  }
  if (data?.favicon) {
    const image = await req.payload.findByID({
      collection: 'media',
      id: Number(id(data.favicon)),
      depth: 0,
      req,
      overrideAccess: false,
    })
    if (!image.mimeType?.startsWith('image/'))
      errors.push({ path: 'favicon', message: 'Choose an image for the Site Icon.' })
  }
  if (errors.length) throw new ValidationError({ errors })
  return data
}
