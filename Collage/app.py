# Flask app main script
from flask import Flask, request, send_file, render_template_string
from PIL import Image
import io

app = Flask(__name__)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Botanical Collage Tool</title>
</head>
<body>
    <h2>Upload Your Flower Photos</h2>
    <form method="POST" action="/generate" enctype="multipart/form-data">
        <input type="file" name="images" multiple required><br><br>
        <label>Output Width:</label>
        <input type="number" name="width" value="3000"><br><br>
        <label>Output Height:</label>
        <input type="number" name="height" value="2000"><br><br>
        <input type="submit" value="Generate Collage">
    </form>
</body>
</html>
"""

@app.route('/')
def home():
    return render_template_string(HTML_TEMPLATE)

@app.route('/generate', methods=['POST'])
def generate():
    files = request.files.getlist("images")
    width = int(request.form.get("width", 3000))
    height = int(request.form.get("height", 2000))

    base = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    for f in files:
        img = Image.open(f.stream).convert("RGBA")
        img = img.resize((300, 300))  # Temp fixed size
        base.paste(img, (0, 0), img)

    buf = io.BytesIO()
    base.save(buf, format='PNG')
    buf.seek(0)

    return send_file(buf, mimetype='image/png', as_attachment=True, download_name="collage.png")

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
