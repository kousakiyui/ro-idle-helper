# tests：jsdom 模擬測試

```sh
cd tests && npm ci          # 安裝 jsdom（node_modules 不要提交）
cd .. && sh tests/run-all.sh ro-idle-helper.test.user.js
```

- `run-all.sh <userscript>`：先 `node --check`，再跑清單中的每組 sim（每組 timeout 60 秒，單組失敗不會中斷其他組）。
- 判讀：每行 `PASS`/`FAIL`；多數 sim 最後印 `ALL PASS` 或 `SOME FAIL`；`review-sim_wh`、`review-sim_wh_corrupt` 只印數據行。v3.5.1.5 基準：12 組、121 個 PASS、0 個 FAIL。
- 單跑：`node tests/<name>.cjs ro-idle-helper.test.user.js`。
- `review-sim_cadence.cjs`、`review-sim_poll.cjs` 是舊版用的，不在 run-all 清單。
- 新增 sim 請加進 `run-all.sh` 的 for 清單。
- 需要 Node 18+（實測 Node 24）。
