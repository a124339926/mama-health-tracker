alter table public.readings drop constraint readings_measurement_type_check,
 add constraint readings_measurement_type_check check (measurement_type in ('fasting','postmeal','bedtime','other'));
