# Backend Guidance

- Do not use prepared statements for database queries. The Supabase transaction pooler does not support prepared statements. Use query APIs compatible with transaction pooling instead.
