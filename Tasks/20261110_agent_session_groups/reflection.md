# Рефлексия

Инструмент модели отсутствовал не из-за отсутствия UI группировки, а из-за разницы public client actions и Host capability. Новый tool использует действующий Host sessionController.rename, не копирует browser sessions.using на сервер.

Нельзя трактовать remoteAccess.allows вне Remote как agent ACL, а пользовательское разрешение «без вопроса» — как обход Tools pipeline. Tool power выбран явно для всех сессий указанного workspace; caller identity и действующая native policy сохраняются.

Важные ранние замечания parent применены: cross-workspace concurrent operation reservation до первого await, отсутствие ложного completed результата inflight replay, dryRun не снимает write lock; N+2K reads вместо полного workspace на каждую запись; allSettled drain с обязательной проверкой ошибок и release failure. Native lifecycle доказывает rename без prompt/unarchive, а list/preview без Agent activation.

Остаток: persistent browser-local пустые группы не имеют Host API; не придумывать третье хранилище и не обещать создание пустой группы. Lifetime ledger/fence не являются durable exactly-once или межклиентной транзакцией.
