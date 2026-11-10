# Контракт инструментов

Все четыре инструмента регистрируются штатным ctx.tools.register в optional child. Вызовы проходят штатный Tools pipeline с exec.agent/signal/callId. remoteAccess.allows сохраняет Remote scope guard, но не выдаётся за отдельную систему agent grants: вне Remote вызова он может возвращать true. Это owner-trusted capability для любого явно выбранного workspace, согласно прямому поручению, а не только workspace текущей сессии.

- workspace_grouping_list_workspaces({}) — зарегистрированные ID, название, incarnation и число сессий.
- workspace_session_groups({workspaceId}) — все members включая архивные, authoritative title/provenance, исключения и непустые группы.
- workspace_move_sessions_to_group({workspaceId,sessionIds,targetGroup,dryRun?,operationId?}) — явные ID, destination segments; [] — корень. До256 targets.
- workspace_rename_session_group({workspaceId,sourceGroup,targetGroup,dryRun?,operationId?}) — точный исходный parsed prefix и вложенные members; destination [] поднимает их в корень.

Для записи нужен уникальный operationId; dryRun не требует его и не пишет. Это машинная identity для replay, не обязательное подтверждение владельцем/двухфазный протокол. Повтор того же owner/operationId возвращает сохранённый результат, несовпадающие аргументы отказывают; inflight replay не выдаётся за завершённый отчёт. До256 identity, общий резерв результата16MiB, не более1MiB output. При заполнении — явный отказ, не eviction неизвестных исходов. Ledger живёт только в Host-процессе: после перезапуска нельзя считать его durable-защитой и автоматически повторять старый write.

Workspace должен быть явно выбран по ID. Полное membership/incarnation проверяются до/после reads и перед каждой записью, title/provenance target перечитываются пассивно. Группа планируется по наблюдаемому начальному составу: внешняя смена title другого, ранее не выбранного member во время операции не добавляет его в уже исполняемый план. Нет атомарного CAS или обещания полной транзакции между клиентами.

Штатный Host sessionController.rename может возобновить Agent и закрепляет source=user; сам не отправляет prompt и не снимает archive. Запись title — единственная мутация. Blank/subagent исключаются явно. Отсутствующий title не заменяется display/cache. Корень/URL/paths/quotes проходят совместимую UI-грамматику и roundtrip validation; непредставимый leaf отвергается.

Отчёт содержит before/after и исход каждого target: success, unchanged, excluded, stale, cancelled, unknown, stale-after-success, not-attempted. Ранние successes не откатываются. Любой неизвестный write прекращает очередь и блокирует новые writes данного workspace на lifetime этого service; list/dryRun остаются доступны. Автоматического retry/reconcile/unfence нет. После отдельной ручной проверки исхода возможно контролируемое переоткрытие Host lifecycle; это эксплуатационный остаток, а не гарантия, что readback отменяет ещё выполняющийся write.

Пустые группы browser-local в UI: инструменты не создают durable пустые declarations. Перемещение member создаёт непустую проекционную группу; существующие declarations и локальные prefs не меняются. Session grouping должен быть включён в UI, чтобы проекция отображалась.
