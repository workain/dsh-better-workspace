# Проверки

Node24.13.1, immutable SDK0.2.2-rc.1, Chromium Playwright. Исходные118tests сохранены; финальные132tests:132pass,0fail,0skip. Новые14 исполняют actual production modules/registration, а не дублированную модель: точные A/B и arbitrary selected workspace, archive/blank/subagent/foreign, parsed nested prefix, opaque/path/quote roundtrip, schema, replay, cross-workspace concurrent identity, dryRun lock, partial unknown fence, stale title, cancellation drain и disposal failure fail-closed. Count test доказывает N+2K observations вместо N*K; это не browser SLA и не измерение latency полного replay больших холодных histories.

Host grammar — parity-enforced extraction канонического UI source block. UI parser не переписывался; byte-for-byte test и executable corpus сравнивают оба. Это не утверждение, что браузер импортирует Host ESM-модуль.

Native test e2e/groups.py использует конечный существующий runner с новым HOME/DSH_HOME/XDG/cwd/loopback ephemeral port и allowlist env. Пакет извлекается из указанного exact tarball. Fixture-only маршрут вызывает ctx.tools.execute с четырьмя настоящими зарегистрированными tools и реальным Agent, без log model-step. Actor resumed до passive baseline; list/dryRun сохраняют exact events/headers/Agent flags. Rename выбирает свою/чужие сессии A и отдельно B при actor из A; A write не меняет B. Archive set неизменен, prompts0, replay не повторяет. После reload Chromium видит группу RenamedTools. Pageerror0, server_stopped=true. Два последовательных полноценных native прогона PASS, финальный после drain fix.

Пример воспроизведения: npm test; npm pack --ignore-scripts; затем BW_ARTIFACT="$TARBALL" BW_SDK="$SDK_RELEASE" BW_PRIVATE="$PRIVATE_ARTIFACTS" BW_NODE="$NODE_BINARY" PLAYWRIGHT_BROWSERS_PATH="$BROWSER_CACHE" "$PLAYWRIGHT_PYTHON" tests/e2e/groups.py.

Все25 packedfiles сверены побайтово с source; tests/Tasks/fixture/logs/env/DB внутри нет. Tarball0.41.0-workain.3 SHA256 e9db6282df2cc566df434fc799641bfdbaed3a11442a83c21cfc7dbd5b1d6a8b.

Реальные production сессии не менялись. Человеческий pixel review, полный повтор всех manual UI/theme/locale комбинаций и многоклиентная транзакционная атомарность не заявлены. Native тест не обращался к модели/OAuth/Tracker/Telegram. Parent owns независимое ревью/повторение и отдельную установку.
