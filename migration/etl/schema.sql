-- Схема контента top-barbershop (PostgreSQL). Пересоздаётся скриптом etl.py.
DROP TABLE IF EXISTS barbershop_metro, barbershop_collections, post_categories, favorites, reviews, post_comments,
  barbershops, metro, chains, collections, locations, posts, categories, pages, schools, school_cities,
  vacancies, vacancy_cities, site_users, features CASCADE;

CREATE TABLE features (key text PRIMARY KEY, label text NOT NULL, kind text NOT NULL, sort int, filterable bool DEFAULT false);

CREATE TABLE locations (id int PRIMARY KEY, name text NOT NULL, slug text NOT NULL, parent_id int REFERENCES locations(id),
  path text UNIQUE NOT NULL, seo_title text, description text, listings_count int DEFAULT 0);

CREATE TABLE metro (id int PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, city_code text, seo_title text, listings_count int DEFAULT 0);
CREATE TABLE chains (id int PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, description text, seo_title text, image text);
CREATE TABLE collections (id int PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, description text, seo_title text);

CREATE TABLE site_users (id int PRIMARY KEY, login text, email text, display_name text, first_name text, last_name text,
  phone text, avatar text, city text, socials jsonb, role text, wp_pass_hash text, registered_at timestamptz, directus_user uuid);

CREATE TABLE barbershops (
  id int PRIMARY KEY, slug text, title text NOT NULL, status text NOT NULL DEFAULT 'published', closed bool DEFAULT false,
  description text, address text, map_address text, lat double precision, lng double precision,
  phone text, email text, website text, booking_url text, booking_url_alt text,
  instagram text, instagram_login text, vk text, facebook text, youtube text, video text,
  featured bool DEFAULT false, views int DEFAULT 0, rating numeric(3,2), reviews_count int DEFAULT 0,
  location_id int REFERENCES locations(id), chain_id int REFERENCES chains(id), owner_id int REFERENCES site_users(id),
  amenities jsonb DEFAULT '[]', services jsonb DEFAULT '{}', opening_hours jsonb, gallery jsonb DEFAULT '[]', cover_image text,
  seo_title text, seo_description text, legacy_meta jsonb, created_at timestamptz, updated_at timestamptz);
CREATE UNIQUE INDEX barbershops_slug_pub ON barbershops(slug) WHERE status='published';
CREATE INDEX ON barbershops(location_id); CREATE INDEX ON barbershops(chain_id); CREATE INDEX ON barbershops(status);

CREATE TABLE barbershop_metro (id serial PRIMARY KEY, barbershop_id int REFERENCES barbershops(id) ON DELETE CASCADE, metro_id int REFERENCES metro(id) ON DELETE CASCADE);
CREATE TABLE barbershop_collections (id serial PRIMARY KEY, barbershop_id int REFERENCES barbershops(id) ON DELETE CASCADE, collection_id int REFERENCES collections(id) ON DELETE CASCADE);

CREATE TABLE reviews (id int PRIMARY KEY, barbershop_id int REFERENCES barbershops(id) ON DELETE CASCADE, user_id int REFERENCES site_users(id),
  author_name text, author_email text, rating int, pros text, cons text, content text, status text, created_at timestamptz);

CREATE TABLE favorites (id serial PRIMARY KEY, user_id int REFERENCES site_users(id) ON DELETE CASCADE, barbershop_id int REFERENCES barbershops(id) ON DELETE CASCADE);

CREATE TABLE categories (id int PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, description text, seo_title text);
CREATE TABLE posts (id int PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, status text, content text, excerpt text,
  cover_image text, author_id int, seo_title text, seo_description text, noindex bool DEFAULT false, published_at timestamptz, updated_at timestamptz);
CREATE TABLE post_categories (id serial PRIMARY KEY, post_id int REFERENCES posts(id) ON DELETE CASCADE, category_id int REFERENCES categories(id) ON DELETE CASCADE);
CREATE TABLE post_comments (id int PRIMARY KEY, post_id int REFERENCES posts(id) ON DELETE CASCADE, author_name text, content text, status text, created_at timestamptz);

CREATE TABLE pages (id int PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, status text, content text, template text,
  seo_title text, seo_description text, noindex bool DEFAULT false, updated_at timestamptz);

CREATE TABLE school_cities (id int PRIMARY KEY, name text, slug text UNIQUE);
CREATE TABLE schools (id int PRIMARY KEY, slug text UNIQUE, title text, status text, content text, cover_image text, city_id int REFERENCES school_cities(id),
  phone text, address text, site text, duration text, from_zero text, credit text, tools text, updated_at timestamptz);
CREATE TABLE vacancy_cities (id int PRIMARY KEY, name text, slug text UNIQUE);
CREATE TABLE vacancies (id int PRIMARY KEY, slug text UNIQUE, title text, status text, content text, cover_image text, city_id int REFERENCES vacancy_cities(id),
  address text, barbershop_name text, barbershop_link text, schedule text, salary text, phone text, published_at timestamptz);
