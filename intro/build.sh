# Tam render: 180 alt kare/sn → tmix ile 60 fps hareket bulanıklığı + WAV müzik
set -e
cd "$(dirname "$0")"
S=${TMPDIR:-/tmp}/tuscord-intro-frames; rm -rf $S; mkdir -p $S
NODE_PATH=$(npm root -g) node render.cjs audio $S/music.wav
NODE_PATH=$(npm root -g) node render.cjs full $S
FF=${FFMPEG:-ffmpeg}
$FF -loglevel error -y -framerate 180 -i $S/f%05d.jpg -i $S/music.wav \
  -vf "tmix=frames=3:weights='1 1 1',select='eq(mod(n\,3)\,2)',setpts=N/(60*TB)" -r 60 \
  -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow -c:a aac -b:a 192k -shortest tuscord-intro.mp4
cp $S/music.wav tuscord-intro-music.wav
echo DONE
