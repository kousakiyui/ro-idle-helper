#!/bin/sh
# 用法：sh tests/run-all.sh <userscript>
set -e; F=${1:-ro-idle-helper-3.5.1.patched.user.js}; D=$(dirname "$0")
node --check "$F" && echo "node --check OK: $F"
for t in review-sim_wh_switch review-sim_wh_rowsig review-sim_wh_corrupt review-sim_poll_e2e review-sim_wh review-sim_352_units review-sim_352_star review-sim_352_sync review-sim_352_boot review-sim_3513_opt review-sim_3513_partymove review-sim_3513_partymove_ui review-sim_mvp_party_travel review-sim_hud_yield review-sim_waitforui review-sim_map_loot review-sim_monster_sync review-sim_refine_restock review-sim_refine_layout review-sim_combat_hit_rate review-sim_hud_display; do echo "--- $t"; timeout 60 node "$D/$t.cjs" "$F"; done
