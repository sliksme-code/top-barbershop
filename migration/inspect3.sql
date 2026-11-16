SELECT p.ID, p.post_title, p.post_status, (SELECT GROUP_CONCAT(CONCAT(meta_key,'=',LEFT(meta_value,60)) SEPARATOR ' ; ') FROM wp_postmeta m WHERE m.post_id=p.ID AND meta_key NOT LIKE '\_edit%') meta FROM wp_posts p WHERE p.post_type='field' ORDER BY p.menu_order, p.ID;
SELECT meta_key, COUNT(*) FROM wp_postmeta WHERE meta_key LIKE '\_aioseop%' GROUP BY meta_key;
SELECT p.post_type, COUNT(*) FROM wp_postmeta m JOIN wp_posts p ON p.ID=m.post_id WHERE m.meta_key='_aioseop_title' GROUP BY p.post_type;
SELECT option_name, LEFT(option_value,300) FROM wp_options WHERE option_name LIKE 'aioseop_options' ;
