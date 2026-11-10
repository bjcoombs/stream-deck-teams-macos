#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
assets_dir="$project_dir/assets"
plugin_dir="$project_dir/com.laurens-bolle.teams-reactions.sdPlugin"
plugin_images="$plugin_dir/imgs/plugin"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required to regenerate the PNG icons." >&2
  echo "Install librsvg with Homebrew, then rerun npm run build:icons." >&2
  exit 1
fi
if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to render the inactive key images." >&2
  echo "Install imagemagick with Homebrew, then rerun npm run build:icons." >&2
  exit 1
fi

# A key image and its dimmed twin, keeping its colours, shown while no Teams meeting is active.
render_key() {
  source_svg=$1
  output=$2
  rsvg-convert -w 72 -h 72 -o "$output.png" "$source_svg"
  rsvg-convert -w 144 -h 144 -o "$output@2x.png" "$source_svg"
  for suffix in "" "@2x"; do
    magick "$output$suffix.png" -modulate 100,75 -channel A -evaluate multiply 0.45 +channel \
      -define png:color-type=6 "$output-inactive$suffix.png"
  done
}

mkdir -p "$plugin_images"
rsvg-convert -w 256 -h 256 -o "$plugin_images/marketplace.png" "$assets_dir/plugin.svg"
rsvg-convert -w 512 -h 512 -o "$plugin_images/marketplace@2x.png" "$assets_dir/plugin.svg"
rsvg-convert -w 28 -h 28 -o "$plugin_images/category-icon.png" "$assets_dir/category.svg"
rsvg-convert -w 56 -h 56 -o "$plugin_images/category-icon@2x.png" "$assets_dir/category.svg"

for reaction in like love applause laugh surprise; do
  action_images="$plugin_dir/imgs/actions/$reaction"
  mkdir -p "$action_images"
  rsvg-convert -w 20 -h 20 -o "$action_images/icon.png" "$assets_dir/$reaction-icon.svg"
  rsvg-convert -w 40 -h 40 -o "$action_images/icon@2x.png" "$assets_dir/$reaction-icon.svg"
  render_key "$assets_dir/$reaction-key.svg" "$action_images/key"
done

render_control() {
  control=$1
  shift
  action_images="$plugin_dir/imgs/actions/$control"
  mkdir -p "$action_images"
  rsvg-convert -w 20 -h 20 -o "$action_images/icon.png" "$assets_dir/$control-icon.svg"
  rsvg-convert -w 40 -h 40 -o "$action_images/icon@2x.png" "$assets_dir/$control-icon.svg"
  for state_asset in "$@"; do
    state_name=${state_asset#"$control-"}
    render_key "$assets_dir/$state_asset-key.svg" "$action_images/$state_name"
  done
}

render_control mute mute-unmuted mute-muted
render_control camera camera-on camera-off
render_control blur blur-on blur-off
render_control push-to-talk push-to-talk-unmuted push-to-talk-muted
render_control hand hand-lowered hand-raised
render_control leave leave

echo "Regenerated Stream Deck icons in: $plugin_dir/imgs"
