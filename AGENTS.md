# Backend Guidance

- Always write unit tests for every module and feature created.
- Always create a `README.md` in every module to explain that module.
- Place each module's entities in its `entities/` directory and DTOs in its `dto/` directory.
- Do not use prepared statements for database queries. The Supabase transaction pooler does not support prepared statements. Use query APIs compatible with transaction pooling instead.
