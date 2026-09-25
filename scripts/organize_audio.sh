#!/bin/bash
# 整理红警原版音频素材到 Next.js public/audio 目录
# 来源:
#   - archive.org/red_alert_soundtrack-1996 (EA 2008年官方免费发布的RA1游戏原声)
#   - github.com/fbunau/openpeon-red-alert-1-eva (RA1 EVA语音)
#   - github.com/mgmobrien/red-alert-sounds (RA1单位语音)
#   - github.com/ravidorr/cnc-red-alert-soundboard (RA1战斗音效)
PUB=/home/z/my-project/public/audio
OST=/tmp/ra_assets/ost
EVA=/tmp/ra_assets/eva2/openpeon-red-alert-1-eva-main/sounds
VOICES=/tmp/ra_assets/voices
SFX=/tmp/ra_assets/sfx/sounds
MUSIC_HM=/tmp/ra_assets/music

mkdir -p $PUB/music $PUB/eva $PUB/voices $PUB/sfx

# ---------- 音乐 (14首原版OST) ----------
declare -A M=(
 ["hellmarch.mp3"]="01.-hell-march.mp3"
 ["radio.mp3"]="02.-radio.mp3"
 ["crush.mp3"]="03.-crush.mp3"
 ["rollout.mp3"]="04.-roll-out.mp3"
 ["mud.mp3"]="05.-mud.mp3"
 ["twincannon.mp3"]="06.-twin-cannon.mp3"
 ["facetheenemy.mp3"]="07.-face-the-enemy.mp3"
 ["run.mp3"]="08.-run.mp3"
 ["terminate.mp3"]="09.-terminate.mp3"
 ["bigfoot.mp3"]="10.-big-foot.mp3"
 ["workmen.mp3"]="11.-workmen.mp3"
 ["militantforce.mp3"]="12.-militant-force.mp3"
 ["dense.mp3"]="13.-dense.mp3"
 ["vector.mp3"]="14.-vector.mp3"
)
for k in "${!M[@]}"; do cp "$OST/${M[$k]}" "$PUB/music/$k"; done

# ---------- EVA 电脑语音 ----------
declare -A E=(
 ["mission-loaded"]="ack9_mission_loaded.WAV"
 ["building"]="ack1_building.WAV"
 ["training"]="ack2_training.WAV"
 ["repairing"]="ack5_repairing.WAV"
 ["primary-building-selected"]="ack6_primary_building_selected.WAV"
 ["mission-accomplished"]="complete1_mission_accomplished.WAV"
 ["unit-ready"]="complete2_unit_ready.WAV"
 ["construction-complete"]="complete3_construction_complete.WAV"
 ["reinforcements"]="complete6_reinforcements_have_arrived.WAV"
 ["battle-control-terminated"]="end1_battle_control_terminated.WAV"
 ["unit-lost"]="error1_unit_lost.WAV"
 ["base-under-attack"]="error2_base_under_attack.WAV"
 ["command-center-under-attack"]="error3_command_center_under_attack.WAV"
 ["abomb-launch-detected"]="error4_a_bomb_launch_detected.WAV"
 ["structure-destroyed"]="error8_structure_destroyed.WAV"
 ["low-power"]="limit1_low_power.WAV"
 ["insufficient-funds"]="limit2_insufficient_funds.WAV"
 ["insufficient-power"]="limit3_insufficient_power.WAV"
 ["silos-needed"]="limit4_silos_needed.WAV"
 ["allied-forces-fallen"]="other_allied_forces_have_fallen.WAV"
 ["mission-failed"]="other_mission_failed.WAV"
 ["soviet-empire-fallen"]="other_soviet_empire_has_fallen.WAV"
 ["new-construction-options"]="required1_new_construction_options.WAV"
 ["select-target"]="required2_select_target.WAV"
 ["abomb-ready"]="required6_abomb_ready.WAV"
)
for k in "${!E[@]}"; do cp "$EVA/${E[$k]}" "$PUB/eva/$k.wav"; done
# mgmobrien 补充
cp $VOICES/ra_canceled.wav $PUB/eva/canceled.wav 2>/dev/null || true
cp $VOICES/ra_buzzy1.wav $PUB/eva/buzzy.wav 2>/dev/null || true
cp $VOICES/ra_unable_to_build.wav $PUB/eva/unable-to-build.wav 2>/dev/null || true
cp $VOICES/ra_on_hold.wav $PUB/eva/on-hold.wav 2>/dev/null || true

# ---------- 单位语音 ----------
# 通用应答语音(带阵营/类型变体)
for side in allied soviet; do
  for kind in infantry vehicle; do
    for base in acknowledged affirmative agreed as_you_wish at_once awaiting_orders very_well yes_sir vehicle_reporting; do
      for n in 1 2; do
        src=$VOICES/ra_${base}_${side}_${kind}_$n.wav
        [ -f "$src" ] && cp "$src" "$PUB/voices/$side-$kind-${base//_/-}-$n.wav"
      done
    done
  done
done
# 死亡音
for i in 1 2 3 4 5 6 7 8 9 10; do cp $VOICES/ra_death_dedman$i.wav $PUB/voices/death-$i.wav 2>/dev/null; done
# 特殊单位
for f in engineer_affirmative engineer_engineering engineer_movin_out engineer_yes_sir; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done
for f in medic_affirmative medic_movin_out medic_reporting medic_yes_sir; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done
for f in mechanic_hot_diggity mechanic_howdy mechanic_i_hear_ya mechanic_sure_thing_boss mechanic_yes_sir mechanic_guffaw; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done
for f in spy_commander spy_for_king_and_country spy_indeed spy_on_my_way spy_yes_sir; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done
for f in tanya_cha_ching tanya_chew_on_this tanya_give_it_to_me tanya_im_there tanya_kiss_it_bye_bye tanya_laugh tanya_lets_rock tanya_shake_it_baby tanya_thats_all_you_got tanya_whats_up tanya_yea tanya_yes_sir; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done
for f in dog_bark dog_growl dog_whine dog_yes_sir; do cp $VOICES/ra_$f.wav $PUB/voices/$f.wav 2>/dev/null; done

# ---------- 战斗与系统音效 ----------
declare -A S=(
 ["gun-shot"]="minigunner_shot.wav"
 ["gun-rapid"]="rapid_shoot.wav"
 ["pistol-1"]="pistol_1.wav"
 ["pistol-2"]="pistol_2.wav"
 ["light-tank-gun"]="light_tank_gun.wav"
 ["mammoth-tank-gun"]="mammoth_tank_gun.wav"
 ["artillery"]="artillery.wav"
 ["cruiser-gun"]="cruiser_8_inch_cannon.wav"
 ["destroyer-gun"]="destroyer_shot.wav"
 ["pillbox-gun"]="pillbox_shot.wav"
 ["ranger-gun"]="ranger_firing_sound.wav"
 ["missile"]="air_to_air_missile.wav"
 ["sam-shot"]="ground_to_air_missile_shot.wav"
 ["explosion-1"]="explosion.wav"
 ["explosion-2"]="explosion2.wav"
 ["water-explosion"]="water_explosion.wav"
 ["tesla-charge"]="tesla_charge.wav"
 ["tesla-zap"]="tesla_shot.wav"
 ["flame-1"]="flame_sound_1.wav"
 ["flame-2"]="flame_sound_2.wav"
 ["building-place"]="building_being_placed.wav"
 ["building-place-2"]="building_placement_sound.wav"
 ["building-destroyed"]="building_destroyed.wav"
 ["building-half-destroyed"]="building_half_destroyed.wav"
 ["wall-crumbling"]="wall_crumbling.wav"
 ["wall-hit"]="wall_hit.wav"
 ["credit-in"]="credit_in.wav"
 ["credit-out"]="credit_out.wav"
 ["selling"]="selling.wav"
 ["power-up"]="power_up.wav"
 ["power-down"]="power_down.wav"
 ["radar-alert"]="radar_map_alert.wav"
 ["radar-on"]="radar_map_power_on.wav"
 ["alarm"]="alarm.wav"
 ["bleep"]="bleep11.wav"
 ["bleep-2"]="bleep17.wav"
 ["beepy"]="beepy6.wav"
 ["toney"]="toney4.wav"
 ["toney-2"]="toney7.wav"
 ["scold"]="scold1.wav"
 ["clock"]="clock_1.wav"
 ["briefing"]="briefing.wav"
 ["keystroke"]="keystroke.wav"
 ["mine-placed"]="mine_placed.wav"
 ["appear"]="appear_1.wav"
 ["chronosphere"]="chronosphere_sound.wav"
 ["iron-curtain"]="iron_curtain_sound.wav"
 ["squashed"]="man_being_squashed.wav"
 ["paratroops"]="paratroops.wav"
)
for k in "${!S[@]}"; do cp "$SFX/${S[$k]}" "$PUB/sfx/$k.wav"; done
for i in 1 2 3 4 5 6 7 8 9; do cp $SFX/man_die_$i.wav $PUB/sfx/man-die-$i.wav 2>/dev/null; done

echo "=== 整理完成 ==="
echo "music: $(ls $PUB/music | wc -l) 首, $(du -sh $PUB/music | cut -f1)"
echo "eva:   $(ls $PUB/eva | wc -l) 个, $(du -sh $PUB/eva | cut -f1)"
echo "voices:$(ls $PUB/voices | wc -l) 个, $(du -sh $PUB/voices | cut -f1)"
echo "sfx:   $(ls $PUB/sfx | wc -l) 个, $(du -sh $PUB/sfx | cut -f1)"
echo "TOTAL: $(du -sh $PUB | cut -f1)"
