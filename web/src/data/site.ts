// Единый источник служебных данных сайта. Значения перенесены со старого WordPress.
export const site = {
  name: 'TOP BARBERSHOP',
  tagline: 'Первый каталог барбершопов и журнал',
  defaultTitle: 'Каталог Барбершопов — Фото, обзоры, цены и онлайн запись!',
  defaultDescription:
    'Все барбершопы (мужские парикмахерские) страны с поиском, картой, описанием, фотографиями, отзывами и рейтингами. Никаких женских салонов. Записывайся онлайн!',
  ogImage: '/soc.jpg',
  ogSiteName: 'TOP BARBERSHOP',
  altName: 'Каталог барбершопов России и СНГ',
  locale: 'ru_RU',
  // Подтверждение прав (метатеги со старого сайта, добавлены 16.11.2026)
  verification: {
    yandex: 'ea04cd77262cd3d4',
    google: 'X5D8XYV2g_L39YyHaOqFcFUoIxo86dT0dXYudmEueYg',
  },
  // Яндекс Метрика: тот же счётчик и те же идентификаторы целей, что на WordPress
  metrikaId: 36802255,
  goals: {
    booking: 'online',        // «Запись»
    callShop: 'callmebaby',   // «Звонок в шоп»
    siteClick: 'sitemebaby',  // «Переход на сайт»
    vkPopup: 'vkgroup',
    blogView: 'blogposts',
    push: 'pushme',
  },
  social: {
    vk: 'https://vk.com/top_bs',
  },
  // Главное меню (как на текущем сайте)
  nav: [
    { href: '/listings/', label: 'Все места' },
    { href: '/location/russia/msk/', label: 'Москва' },
    { href: '/location/russia/spb/', label: 'Санкт-Петербург' },
    { href: '/location/russia/krasnodar/', label: 'Краснодар' },
    { href: '/location/russia/nsk/', label: 'Новосибирск' },
    { href: '/location/russia/kzn/', label: 'Казань' },
    { href: '/location/ukraina/kiev/', label: 'Киев' },
    { href: 'https://awards.top-barbershop.com/', label: 'Awards' },
    { href: '/zhurnal/', label: 'Журнал' },
    { href: '/school/', label: 'Школы' },
    { href: '/vacancy/', label: 'Вакансии' },
  ],
  footer: [
    { href: '/about/', label: 'О проекте' },
    { href: '/add/', label: 'Добавить барбершоп' },
    { href: '/contact/', label: 'Контакты' },
    { href: '/logo/', label: 'Логотипы' },
  ],
} as const;

export const isProduction = process.env.SITE_ENV === 'production';
// Один контейнер обслуживает и боевой, и тестовый домен: индексируем только боевой
export const isProdHost = (req: Request) => {
  const h = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0].toLowerCase();
  return h === 'top-barbershop.com';
};
