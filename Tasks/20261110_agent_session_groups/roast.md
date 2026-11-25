# Риски до реализации

- Группировка — запись пользовательского title и возможное возобновление Agent штатным rename; это не prompt и не archive/unarchive. Пассивное чтение и dryRun не должны активировать Agent.
- Полный состав workspace включает архивные сессии. Не использовать UI list/age/search или глобальный prefix. Blank/subagent явно исключаются, неизвестные title не подставляются из display/cache.
- Кавычки/пути/URL делают split('/') неверным. Грамматика должна быть единой; после записи проверить roundtrip представление title или отказать до изменения.
- Rename не имеет CAS и транзакции на несколько сессий. Revalidate перед каждой записью, sequential report, не откатывать успехи и не повторять unknown. Workspace serialization и identity защищают конкурентные tool calls, но не обещают межклиентную атомарность.
- Нельзя обходить действующий remoteAccess и tool policy; отсутствие approval dialog по прямому выбору владельца не означает произвольный filesystem-write.
- Optional host child не должен отключить sidebar без tools/SDK peers. Native fixture только в свежем HOME с синтетическими сессиями.
