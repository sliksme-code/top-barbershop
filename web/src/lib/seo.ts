const SITE = process.env.SITE_URL || 'https://top-barbershop.com';
export const abs = (p: string) => new URL(p, SITE).href;
export const breadcrumbLd = (items: [string, string?][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(href ? { item: abs(href) } : {}) })),
});
export const faqLd = (faq: { q: string; a: string }[]) =>
  faq.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      }
    : null;
