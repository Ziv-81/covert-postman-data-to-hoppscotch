"""
Flask web server – accepts a Postman collection JSON upload,
converts it to Hoppscotch format and returns it as a downloadable file.
"""

import io
import os

from flask import Flask, jsonify, render_template, request, send_file

from converter import convert_json_string

app = Flask(__name__)

# Maximum accepted upload size: 10 MB
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/convert", methods=["POST"])
def convert():
    if "file" not in request.files:
        return jsonify({"error": "No file part in the request."}), 400

    uploaded_file = request.files["file"]

    if uploaded_file.filename == "":
        return jsonify({"error": "No file selected."}), 400

    if not uploaded_file.filename.lower().endswith(".json"):
        return jsonify({"error": "Only JSON files are accepted."}), 400

    raw_content = uploaded_file.read().decode("utf-8")

    try:
        hoppscotch_json = convert_json_string(raw_content)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 422

    output = io.BytesIO(hoppscotch_json.encode("utf-8"))
    output.seek(0)

    # Derive a sensible output filename from the uploaded filename
    base_name = os.path.splitext(uploaded_file.filename)[0]
    download_name = f"{base_name}_hoppscotch.json"

    return send_file(
        output,
        mimetype="application/json",
        as_attachment=True,
        download_name=download_name,
    )


if __name__ == "__main__":
    app.run(debug=True)
