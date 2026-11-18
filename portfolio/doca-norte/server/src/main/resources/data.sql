insert into dock(id,name,cargo,status,carrier,version)
select v.id,v.name,v.cargo,v.status,v.carrier,0 from (values
 ('D1','Doca 01','Carga seca','free',''),
 ('D2','Doca 02','Refrigerada','servicing','Linha Azul'),
 ('D3','Doca 03','Carga seca','booked','Expresso Caju'),
 ('D4','Doca 04','Fracionada','free',''),
 ('D5','Doca 05','Paletizada','servicing','Via Serra'),
 ('D6','Doca 06','Fracionada','free','')
) as v(id,name,cargo,status,carrier) where not exists(select 1 from dock d where d.id=v.id);
