from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path
out=Path('public/getting-started')
c=canvas.Canvas(str(out/'reading-corner-brief.pdf'),pagesize=(595,842))
for num,title,subtitle,sections in [
 (1,'A corner of your own','READING CORNER / PROJECT BRIEF',[
 ('The idea',['Make a comfortable place to read for twenty minutes a day.', 'Start with the space you have and reuse furniture you love.']),
 ('What matters',['Choose a quiet corner with comfortable light.', 'Keep a clear walking path and a small surface for a cup.', 'Put a few favorite books within easy reach.']),
 ('First experiment',['Move an existing chair near the window.', 'Try reading there in the morning and in the evening.', 'Write down one thing to improve before buying anything.'])]),
 (2,'From idea to action','READING CORNER / WORKING NOTES',[
 ('A small plan',['Measure the corner and sketch the furniture footprint.', 'Compare two lighting options and record your decision.', 'Try the arrangement, then adjust it after a week.']),
 ('Example budget',['Chair: 120    |    Lamp: 35    |    Shelf: 45', 'Subtotal: 200    |    Contingency (10%): 20', 'Total: 220 example units. These are fictional planning numbers.']),
 ('Your next step',['Highlight a useful sentence in this PDF.', 'Create a highlight card and connect it to a project note.', 'Use the source link to return to the passage later.'])])]:
 c.setFillColor(HexColor('#F8F5EE')); c.rect(0,0,595,842,fill=1,stroke=0)
 c.setFillColor(HexColor('#317168')); c.setFont('Helvetica-Bold',10); c.drawString(48,778,subtitle)
 c.setFillColor(HexColor('#242C2B')); c.setFont('Helvetica-Bold',30); c.drawString(48,722,title)
 y=652
 for heading,lines in sections:
  c.setFillColor(HexColor('#317168')); c.setFont('Helvetica-Bold',14); c.drawString(48,y,heading); y-=30
  c.setFillColor(HexColor('#242C2B')); c.setFont('Helvetica',12)
  for line in lines: c.drawString(48,y,line); y-=23
  y-=38
 c.setStrokeColor(HexColor('#D5DCD7')); c.line(48,75,547,75)
 c.setFont('Helvetica',10); c.drawString(48,52,'Knot / Getting Started / Editable sample project'); c.drawRightString(547,52,str(num))
 c.showPage()
c.save()
(out/'project-checklist.txt').write_text('Reading corner\n\n[ ] Measure the space\n[ ] Try an existing chair\n[ ] Test the evening light\n[ ] Read for twenty minutes\n',encoding='utf-8')
