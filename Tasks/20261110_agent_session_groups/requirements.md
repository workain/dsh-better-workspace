# Агентская группировка сессий

Существующая задача GUARD-379; новый прямой запрос владельца 10.11.2026. Владелец уточнил: агент работает со всеми сессиями явно выбранного workspace, обязательный запрос подтверждения не нужен. Не ограничивать инструмент собственной сессией агента. Это разрешение проектировать/реализовать инструмент, не произвольное изменение текущих сессий в ходе проверки и не установка нового пакета в рабочий профиль.

## Требуемое поведение

- Агент читает зарегистрированные workspace, их сессии и текущую структуру групп; затем перемещает конкретные сессии в заданную группу/корень и переименовывает/перемещает существующую группу.
- Выбранный workspace всегда передаётся точным ID, не вычисляется из cwd/title/текущего GUI selection. Все members ограничены этим workspace. Никакого глобального title-prefix sweep.
- Нет обязательной Approval.request для группировки. Если действующий tool/Session/remoteAccess контракт отказывает, не обходить его через файловую запись, приватный manager или смену sandbox/approval policy. Дополнительную permissive policy не создавать.
- Группы — виртуальные названия сессий, не каталоги. Пользователь должен понимать, что эти операции меняют title и делают его пользовательским. Не переписывать сообщения, membership, pin/archive, goals/todo, board links/status/categories.
- Членство полное, включая скрытые архивные и возрастные сессии; subagent и blank carrier не переименовывать скрытно. Явно вернуть исключения/причины. Scope archive не сводить к текущему UI-фильтру.
- Источник title — пассивное штатное наблюдение с provenance, не displayTitle/кэш. Автоматический title — opaque leaf; пути/URL/кавычки/слэши должны сохраняться совместимо с реальной грамматикой дерева. Не использовать наивный split('/').
- Пустая группа в текущей версии — browser-local declaration, поэтому нельзя обещать её durable host создание без отдельного реального контракта. Перемещение сессии создаёт отображаемую непустую группу. Проверяемая модель должна честно различать эти варианты.

## Операции и безопасность

План перед write должен содержать before/after и exact targets; preview доступен агенту без отдельного вопроса владельцу. План не обязан требовать второй вызов или подтверждение: допустим dryRun в том же инструменте. Переименования последовательные, без гарантии atomic/CAS/rollback. Перед каждой записью проверять membership/incarnation и authoritative title/provenance; stale/partial/unknown возвращаются поэлементно, untouched — not-attempted. Не повторять unknown автоматически, учесть параллельные вызовы/replay плана.

Штатное переименование может активировать Agent, но само не отправляет prompt/не снимает archive. Исследовать native HOST session rename, не копировать browser sessions.using на сервер без проверки; это отдельное lifecycle-действие, явно описать и протестировать. Пассивные list/preview не активируют Agent.

## Исходники и поставка

Один текущий BWT worktree/ветка task/guard-379-service-session-tree, существующий PR1. Baseline83b0aa9 содержит проверенный candidate2 интеграции Board. Установлено workain.1; оно не меняется этой работой. Новый candidate workain.3 с отдельной версией/артефактом; main не трогать. Board repo/данные вне scope. Новые файлы <600 строк, всё новое host optional/lazy без уничтожения исходного sidebar при отсутствии tools peers. Сохранить MIT и upstream functionality, 21 locale set.

## Приёмка

Production не трогать. Unit/behavioral: точный A/B scope/явный workspace; собственная и чужая сессии в выбранном workspace; отсутствующие/архивные/blank/subagent; opaque/path/quotes; полный nested group rename без чужих одноимённых групп; stale membership/title; cancellation; partial/unknown без повторов; concurrent calls; schema invalid/bounds.

Native disposable SDK0.2.2-rc.1: actual registered tools через Host Tools API, не вызов чистого helper вместо инструмента. Fresh HOME/XDG/cwd/allowlist env, без реальных credentials/history/model/OAuth/Tracker/Telegram. Проверить no-prompt/no-unarchive, passive noAgent/noevents, public rename lifecycle и видимую группу в Chromium. Сохранить прежние118tests, independent review/повторение и exact tarball SHA. Новую версию не включать в рабочую GUI до отдельного разрешения владельца.

Tracker stage-comment ранее отклонён approval_denied; read существующей задачи разрешён, не повторять отклонённую запись и не обходить через REST/CLI. Итоги/PR-ссылки сохраняются в repo/private handoff, ограничение раскрывается.
