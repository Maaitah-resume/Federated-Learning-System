"""
Convert TensorFlow.js federated learning models to pickle format.
Converts JSON (shapes + values) → NumPy arrays → .pkl
"""

import json
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List, Any


class ModelConverter:
    """Convert TF.js federated model JSON to pickle format"""
    
    @staticmethod
    def json_to_pkl(json_path: str, pkl_path: str, metadata: Dict[str, Any] = None):
        """
        Convert JSON model to pickle format.
        
        Args:
            json_path: Path to input JSON model file
            pkl_path: Path to output .pkl file
            metadata: Optional dict with accuracy, participants, timestamp, etc.
        """
        # Load JSON
        with open(json_path, 'r') as f:
            model_data = json.load(f)
        
        shapes = model_data.get('shapes', [])
        values = model_data.get('values', [])
        
        if not shapes or not values:
            raise ValueError("Invalid model JSON: missing 'shapes' or 'values'")
        
        # Reconstruct weight tensors from flattened arrays
        weights = []
        for i, shape in enumerate(shapes):
            flat_values = np.array(values[i], dtype=np.float32)
            weight_tensor = flat_values.reshape(shape)
            weights.append(weight_tensor)
        
        # Build pickle-friendly model dict
        model_dict = {
            'weights': weights,
            'shapes': shapes,
            'format': 'tensorflow.js_federated',
            'metadata': metadata or {}
        }
        
        # Save as pickle
        with open(pkl_path, 'wb') as f:
            pickle.dump(model_dict, f, protocol=pickle.HIGHEST_PROTOCOL)
        
        return pkl_path
    
    @staticmethod
    def pkl_to_dict(pkl_path: str) -> Dict[str, Any]:
        """Load pickle model and return weights as dict"""
        with open(pkl_path, 'rb') as f:
            model_dict = pickle.load(f)
        return model_dict
    
    @staticmethod
    def get_model_info(pkl_path: str) -> Dict[str, Any]:
        """Get model info without loading full weights (memory efficient)"""
        with open(pkl_path, 'rb') as f:
            model_dict = pickle.load(f)
        
        return {
            'num_layers': len(model_dict.get('shapes', [])),
            'shapes': model_dict.get('shapes', []),
            'format': model_dict.get('format', ''),
            'metadata': model_dict.get('metadata', {})
        }


# Example usage
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python model_converter.py <input.json> <output.pkl> [accuracy] [participants]")
        sys.exit(1)
    
    json_file = sys.argv[1]
    pkl_file = sys.argv[2]
    accuracy = float(sys.argv[3]) if len(sys.argv) > 3 else None
    participants = sys.argv[4] if len(sys.argv) > 4 else None
    
    metadata = {}
    if accuracy:
        metadata['accuracy'] = accuracy
    if participants:
        metadata['participants'] = participants
    
    converter = ModelConverter()
    result = converter.json_to_pkl(json_file, pkl_file, metadata)
    print(f"✓ Converted: {json_file} → {result}")
