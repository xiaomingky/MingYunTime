using System;
using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace MingYunInstaller
{
    /// <summary>
    /// 从内嵌 icon.ico 提取位图给 WPF 使用。
    /// WPF 的 Image 不支持 .ico，而图标内部（256/128/64/48）多为 PNG 帧，
    /// 优先解析最大 PNG 帧（不变形且清晰），回退到 System.Drawing 转换。
    /// </summary>
    public static class IconHelper
    {
        const string PackUri = "pack://application:,,,/icon.ico";

        public static ImageSource Load()
        {
            try
            {
                using (var s = Application.GetResourceStream(new Uri(PackUri)).Stream)
                {
                    var png = TryPngFrame(s);
                    if (png != null) return png;
                }
                using (var s = Application.GetResourceStream(new Uri(PackUri)).Stream)
                using (var ic = new Icon(s))
                using (var bmp = ic.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                    ms.Position = 0;
                    var dec = new PngBitmapDecoder(ms, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                    if (dec.Frames.Count > 0) return dec.Frames[0];
                }
            }
            catch { }
            return null;
        }

        /// <summary>解析 ICO 容器，取最大尺寸的 PNG 帧作为 BitmapSource</summary>
        static BitmapSource TryPngFrame(Stream s)
        {
            try
            {
                s.Position = 0;
                using (var br = new BinaryReader(s))
                {
                    if (br.ReadUInt16() != 0 || br.ReadUInt16() != 1) return null;
                    int count = br.ReadUInt16();
                    if (count <= 0 || count > 64) return null;

                    var entries = new (int Width, long Offset, int Size)[count];
                    int best = -1, bestW = 0;
                    for (int i = 0; i < count; i++)
                    {
                        byte w = br.ReadByte();
                        byte h = br.ReadByte();
                        br.ReadByte(); // 颜色数（保留）
                        br.ReadByte(); // 保留
                        br.ReadUInt16(); // 平面数
                        br.ReadUInt16(); // 位深
                        int size = br.ReadInt32();
                        long off = br.ReadUInt32();
                        int ww = w == 0 ? 256 : w;
                        entries[i] = (ww, off, size);
                        if (ww >= bestW && size > 0) { bestW = ww; best = i; }
                    }
                    if (best < 0) return null;

                    s.Position = entries[best].Offset;
                    var data = new byte[entries[best].Size];
                    int read = 0;
                    while (read < data.Length) read += s.Read(data, read, data.Length - read);
                    // PNG 帧签名 89 50 4E 47
                    if (data.Length > 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47)
                    {
                        using (var ms = new MemoryStream(data))
                        {
                            var dec = new PngBitmapDecoder(ms, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                            if (dec.Frames.Count > 0) return dec.Frames[0];
                        }
                    }
                }
            }
            catch { }
            return null;
        }
    }
}