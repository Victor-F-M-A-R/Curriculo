create table if not exists dock (
  id varchar(2) primary key, name varchar(55) not null, cargo varchar(40) not null,
  status varchar(14) not null check (status in ('free','booked','servicing')),
  carrier varchar(50) not null, version bigint not null
);
create table if not exists movement (
  dock_id varchar(2) references dock(id), request_id varchar(36) not null,
  action varchar(10) not null, carrier varchar(50) not null, expected_version bigint not null,
  actor varchar(160) not null, occurred_at timestamp with time zone not null,
  primary key (dock_id, request_id)
);
create index if not exists movement_chronology on movement(occurred_at);
