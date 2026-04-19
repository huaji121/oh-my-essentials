import os
from PIL import Image

SCALE = 8
INPUT_DIR = "./input"
OUTPUT_DIR = "./output"

def dscale(image_path, output_path, scale=SCALE):
    """
    将放大的像素图恢复原始大小
    """

    img = Image.open(image_path)

    width, height = img.size
    new_width = width // scale
    new_height = height // scale
    
    # 使用最近邻插值保持像素风格
    img_resized = img.resize((new_width, new_height), Image.NEAREST)
    img_resized.save(output_path)
    print(f"已保存为 {output_path}, 尺寸: {new_width}x{new_height}")
    return img_resized

if __name__ == "__main__":
  if not os.path.exists(INPUT_DIR):
      os.makedirs(INPUT_DIR)

  if not os.path.exists(OUTPUT_DIR):
      os.makedirs(OUTPUT_DIR)

  for texture in os.listdir(INPUT_DIR):
      input_path = os.path.join(INPUT_DIR, texture)
      output_path = os.path.join(OUTPUT_DIR, texture)

      dscale(input_path, output_path, SCALE)
