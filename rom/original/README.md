# Оригинальный ROM

Проект **не распространяет** ROM Battle City. Положите сюда оригинальный файл:

```
rom/original/_battle_city.nes
```

Требования:
- версия **Battle City (Japan)**, NROM (mapper 0), 16 КБ PRG + 8 КБ CHR;
- sha1: `941ad7ca825e3f86407472113aad00520cb45783`.

Проверка:

```bash
sha1sum rom/original/_battle_city.nes
```

После этого выполните подготовку — из оригинала будут собраны производные артефакты
(патченный ROM для тестов, ROM для фронтенда):

```bash
node scripts/prepare.mjs
```

Файл `rom/original/_battle_city.nes` не коммитится (см. `.gitignore`).
